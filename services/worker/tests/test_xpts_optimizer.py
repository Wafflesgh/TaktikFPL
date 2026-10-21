"""xPts v0, nilai horizon multi-GW, dan optimizer squad (ILP)."""

from app.jobs.run_projections import horizon_value
from app.models.xpts_v0 import FixtureCtx, PlayerForm, expected_minutes, project
from app.optimize.squad import SQUAD_SIZE, Candidate, optimize_squad

REGULAR = PlayerForm(6.0, 5.0, 1.0, 1.0, "a", None)


def test_easy_home_beats_hard_away():
    easy = project(REGULAR, FixtureCtx(fdr=2, is_home=True))["xpts"]
    hard = project(REGULAR, FixtureCtx(fdr=5, is_home=False))["xpts"]
    assert easy > hard > 0


def test_injured_and_doubtful_players():
    injured = PlayerForm(8.0, 8.0, 1.0, 1.0, "i", 0)
    doubt = PlayerForm(8.0, 8.0, 1.0, 1.0, "d", 50)
    assert project(injured, FixtureCtx(3, True))["xpts"] == 0
    assert expected_minutes(doubt) == 45.0


def test_rotation_risk_lowers_minutes():
    rotated = PlayerForm(6.0, 5.0, 0.5, 0.6, "a", None)
    assert expected_minutes(rotated) < expected_minutes(REGULAR)


def test_horizon_rewards_good_run_after_one_hard_fixture():
    """Kasus 'Bruno': GW depan lawan sulit, lalu 3 laga mudah → tetap lebih bernilai dari
    pemain yang hanya bagus di GW depan lalu jadwalnya berat."""

    def run(fdrs):
        return {8 + i: project(REGULAR, FixtureCtx(fdr=f, is_home=True))["xpts"] for i, f in enumerate(fdrs)}

    bruno = run([5, 2, 2, 2])
    short_term = run([1, 5, 5, 5])
    assert bruno[8] < short_term[8]  # GW depan lebih buruk...
    assert horizon_value(bruno, 8) > horizon_value(short_term, 8)  # ...tapi total horizon lebih baik


def _pool():
    pool, pid = [], 1
    for pos, n in SQUAD_SIZE.items():
        for i in range(n * 3):
            # nilai menurun, harga menurun; tim bergiliran 1..10
            pool.append(Candidate(pid, pos, team_id=pid % 10, price_tenths=80 - i * 3, value=20.0 - i))
            pid += 1
    return pool


def test_optimizer_respects_fpl_rules():
    plan = optimize_squad(_pool(), budget_tenths=1000)
    assert plan.status == "Optimal"
    by_id = {c.player_id: c for c in _pool()}
    picked = [by_id[p] for p in plan.squad]
    assert len(picked) == 15 and len(plan.starters) == 11
    for pos, n in SQUAD_SIZE.items():
        assert sum(c.position == pos for c in picked) == n
    assert plan.cost_tenths <= 1000
    teams = [c.team_id for c in picked]
    assert max(teams.count(t) for t in set(teams)) <= 3
    assert plan.captain in plan.starters
    xi = [by_id[p] for p in plan.starters]
    assert sum(c.position == "GKP" for c in xi) == 1
    assert sum(c.position == "DEF" for c in xi) >= 3
