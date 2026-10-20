"""Diagnostik DATABASE_URL: mendeteksi kesalahan umum tanpa mencetak password."""

from app.doctor import check_database_url, describe

GOOD = "postgresql://postgres.abcref:Abc123xyz@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres"


def test_good_url_has_no_problems():
    assert check_database_url(GOOD) == []


def test_brackets_and_placeholder_detected():
    url = (
        "postgresql://postgres.abcref:[YOUR-PASSWORD]@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres"
    )
    problems = " ".join(check_database_url(url))
    assert "kurung siku" in problems and "YOUR-PASSWORD" in problems


def test_at_sign_in_password_detected():
    url = "postgresql://postgres.abcref:Ab@c1@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres"
    assert any("'@'" in p for p in check_database_url(url))


def test_direct_connection_and_transaction_pooler_detected():
    direct = "postgresql://postgres:Abc123@db.abcref.supabase.co:5432/postgres"
    assert any("Direct connection" in p for p in check_database_url(direct))
    tx = GOOD.replace(":5432/", ":6543/")
    assert any("Transaction pooler" in p for p in check_database_url(tx))


def test_empty_url():
    assert check_database_url("") and "kosong" in check_database_url("")[0]


def test_describe_never_prints_password():
    text = describe(GOOD)
    assert "Abc123xyz" not in text and "9 karakter" in text
