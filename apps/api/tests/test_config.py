from expense_tracker_api.core.config import _sqlalchemy_url


def test_standard_postgres_urls_select_psycopg_v3() -> None:
    assert _sqlalchemy_url("postgres://user:pass@host/db?sslmode=require") == (
        "postgresql+psycopg://user:pass@host/db?sslmode=require"
    )
    assert _sqlalchemy_url("postgresql://user:pass@host/db?sslmode=require") == (
        "postgresql+psycopg://user:pass@host/db?sslmode=require"
    )


def test_driver_qualified_postgres_url_is_preserved() -> None:
    url = "postgresql+psycopg://user:pass@host/db?sslmode=require"
    assert _sqlalchemy_url(url) == url
