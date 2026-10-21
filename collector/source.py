from __future__ import annotations

from datetime import date
from decimal import Decimal

from .model import Contract

QUERY = """
SELECT s.signal_key AS source_id, s.contract_key, s.symbol, s.expiration, s.strike,
       s.report_date, COALESCE(s.tier, s.profile) AS tier, s.premium,
       s.annualized_yield, s.collateral, s.dte,
       s.delta AS advertised_delta, q.mark AS entry_mark_per_share,
       q.delta AS entry_delta, q.implied_volatility AS entry_iv,
       q.bid AS entry_bid_per_share, q.ask AS entry_ask_per_share,
       q.underlying_price AS entry_underlying_price,
       q.is_illiquid_quote AS entry_illiquid, q.captured_at_utc AS entry_captured_at
FROM opt.telegram_signal s
INNER JOIN opt.telegram_tracked_contract t ON t.contract_key = s.contract_key AND t.is_active = 1
LEFT JOIN opt.telegram_entry_quote q
  ON q.contract_key = s.contract_key AND q.report_date = s.report_date
WHERE s.is_current = 1 AND s.parse_status = 'parsed' AND s.option_right = 'P'
  AND s.strategy_type = 'CSP'
  AND s.expiration >= CAST(? AS date)
ORDER BY s.signal_key
"""

TRACKED_QUERY = """
SELECT contract_key AS source_id, contract_key, symbol, expiration, strike,
       first_seen_date AS report_date
FROM opt.telegram_tracked_contract
WHERE is_active = 1 AND option_right = 'P'
  AND expiration >= CAST(? AS date)
ORDER BY contract_key
"""

POSITION_QUERY = """
SELECT id AS source_id, authenticated_user_id, account_id, is_paper,
       symbol, expiration_date AS expiration, strike_price AS strike,
       transaction_date, contracts
FROM dbo.option_transactions
WHERE status = 'open' AND action = 'sell_to_open' AND is_paper IN (0, 1)
  AND expiration_date >= CAST(? AS date)
ORDER BY id
"""


def normalize(row: dict, kind: str) -> dict:
    row = dict(row)
    row["source_kind"] = kind
    row["source_id"] = str(row["source_id"]).strip()
    key = str(row.get("contract_key") or f"portfolio:{row['source_id']}").strip()
    if not key or not row["symbol"] or row["strike"] is None:
        raise ValueError("source contains an invalid contract identity")
    contract = Contract(key, row["symbol"].strip().upper(), row["expiration"], Decimal(str(row["strike"])))
    _ = contract.occ
    row["contract_key"] = key
    row["contract"] = contract
    return row


def connect(config: dict[str, str]):
    import pyodbc

    def escape(value: str) -> str:
        return "{" + value.replace("}", "}}") + "}"

    connection_string = (
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER={escape(config['server'])};DATABASE={escape(config['database'])};"
        f"UID={escape(config['user'])};PWD={escape(config['password'])};"
        "Encrypt=yes;TrustServerCertificate=no;Connection Timeout=15;"
        "ApplicationIntent=ReadOnly;"
    )
    return pyodbc.connect(connection_string, timeout=15)


def discover(config: dict[str, str], day: date) -> list[dict]:
    with connect(config) as connection:
        connection.timeout = 20
        cursor = connection.cursor()
        result = []
        for kind, query in (("vader_contract", TRACKED_QUERY), ("signal", QUERY), ("portfolio", POSITION_QUERY)):
            cursor.execute(query, day.isoformat())
            columns = [column[0] for column in cursor.description]
            result.extend(normalize(dict(zip(columns, row, strict=True)), kind) for row in cursor.fetchall())
    return result


COMPARATOR_QUERY = """
SELECT contract_key, price_date, captured_at_utc, market_session,
       bid, ask, mark, mid, last_price, underlying_price, delta, implied_volatility
FROM opt.telegram_contract_price WHERE price_date = CAST(? AS date)
"""

PORTFOLIO_COMPARATOR_QUERY = """
SELECT COALESCE(option_transactions_id_live, option_transactions_id) AS transaction_id,
       CASE WHEN option_transactions_id_live IS NOT NULL THEN 0 ELSE 1 END AS is_paper,
       price_date, created_at, bid, ask, mark, mid, last_price, delta
FROM dbo.option_daily_price
WHERE price_date = CAST(? AS date)
  AND (option_transactions_id_live IS NOT NULL OR option_transactions_id IS NOT NULL)
"""


def comparator_rows(config: dict[str, str], day: date, *, portfolio: bool = False) -> list[dict]:
    with connect(config) as connection:
        connection.timeout = 20
        cursor = connection.cursor()
        cursor.execute(PORTFOLIO_COMPARATOR_QUERY if portfolio else COMPARATOR_QUERY, day.isoformat())
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]
