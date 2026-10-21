"""Model Lab: autosub & kapten, ensemble, pembelajaran bobot, dan simulasi musim."""

from datetime import UTC, datetime

from app.lab.data import Fx, GwBundle, PInfo
from app.lab.models import (
    StackLearner,
    _crowd_mult,
    ensemble_mean,
    ensemble_weighted,
    points_plus,
    recent4,
    season_ppg,
)
from app.lab.simulate import SeasonSim, score_xi

POS = ["GKP", "GKP"] + ["DEF"] * 5 + ["MID"] * 5 + ["FWD"] * 3


def bundle(actual=None, n_players=15):
    players = {i + 1: PInfo(POS[i % 15], 1 + (i % 10), 50, (i + 1) * 100) for i in range(n_players)}
    fixtures = {t: [Fx(10, 20, True, 3)] for t in range(1, 11)}
    history = {pid: [(pid % 7, 90, True)] * 6 for pid in players}
    b = GwBundle(1, 10, 100, datetime(2026, 1, 1, tzinfo=UTC), [10], players, fixtures, history)
    b.actual = actual or {pid: (2, 90) for pid in players}
    return b


def test_autosub_and_vice_captain():
    position = {i + 1: POS[i] for i in range(15)}
    starters = [1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15]  # 1 GK, 3 DEF, 4 MID, 3 FWD
    bench = [2, 6, 7, 12]
    actual = {pid: (2, 90) for pid in range(1, 16)}
    actual[13] = (0, 0)  # striker tidak main → diganti cadangan outfield pertama yang main (6, DEF → 4-4-2)
    actual[15] = (0, 0)  # kapten tidak main → vice (14) dobel
    b = bundle(actual)
    pts, xi = score_xi(starters, bench, 15, 14, b, position)
    assert 6 in xi and 13 not in xi
    assert 7 in xi  # FWD kedua juga diganti (formasi 5-4-1 tetap valid)
    assert pts == 11 * 2 + 2  # 11 pemain main × 2 poin + vice kapten ×2


def test_ensembles():
    a = {1: {10: 2.0}, 2: {10: 4.0}}
    b = {1: {10: 4.0}, 2: {10: 0.0}}
    m = ensemble_mean({"a": a, "b": b}, ["a", "b", "missing"])
    assert m == {1: {10: 3.0}, 2: {10: 2.0}}
    # bobot model yang tidak tersedia dibagi ke model yang ada
    w = ensemble_weighted({"a": a}, {"a": 0.5, "missing": 0.5})
    assert w == {1: {10: 2.0}, 2: {10: 4.0}}


def test_stack_learns_the_informative_model():
    learner = StackLearner(["good", "noise"], min_gws=2)
    for gw in (10, 11, 12):
        b = bundle()
        b.gw = gw
        b.gws = [gw]
        b.actual = {pid: (pid % 5, 90) for pid in b.players}
        good = {pid: {gw: float(pid % 5)} for pid in b.players}
        noise = {pid: {gw: float((pid * 7) % 3)} for pid in b.players}
        learner.add({"good": good, "noise": noise}, b)
    w = learner.weights()
    assert w is not None and w["good"] > 0.9 and w["noise"] < 0.1


def test_baselines_and_crowd():
    b = bundle()
    r = recent4(b)
    assert r[7][10] == 0.0 and r[3][10] == 3.0
    assert season_ppg(b)[3][10] == 3.0
    mult = _crowd_mult(b)
    assert 0.9 <= min(mult.values()) and max(mult.values()) <= 1.15


def test_points_plus_availability_fixtures_and_prior():
    b = bundle(n_players=30)
    b.history[1] = [(0, 0, True)] * 6  # tidak main 6 laga terakhir → peluang main kecil
    b.history[2] = [(8, 90, True)] * 6
    b.history[3] = [(8, 90, False)] * 6  # hanya musim lalu → rate = prior harga × posisi
    single = points_plus(b)[4][10]  # tim 4: satu laga kandang FDR 3 → ×1.06
    b.fixtures[4] = [Fx(10, 20, True, 2), Fx(10, 21, False, 4)]  # DGW
    p = points_plus(b)
    assert p[1][10] < 0.25 * p[2][10]
    assert 0 < p[3][10] < p[2][10]
    # DGW: laga mudah kandang (×1.10×1.06) + laga sulit tandang (×0.90×0.94)
    assert abs(p[4][10] - single / 1.06 * (1.10 * 1.06 + 0.90 * 0.94)) < 1e-9
    assert set(p) == set(b.players)


def test_season_sim_builds_squad_and_scores():
    b = bundle(n_players=40)
    preds = {pid: {10: 1.0 + (pid % 9) * 0.3} for pid in b.players}
    sim = SeasonSim()
    pts = sim.step(preds, b)
    assert len(sim.squad) == 15 and sim.bank >= 0
    assert pts == sim.total and pts > 0


def test_benchmark_model_cannot_be_active():
    from app.lab.models import SPEC_BY_NAME

    assert SPEC_BY_NAME["fpl_xp"].params.get("benchmark") is True
    assert "fpl_xp" not in SPEC_BY_NAME["ensemble_stack"].params["members"]
    assert "fpl_xp" not in SPEC_BY_NAME["ensemble_mean"].params["members"]
