from __future__ import annotations

from datetime import date
from decimal import Decimal

from .model import Contract

QUERY = """
SELECT s.signal_key AS source_id, s.contract_key, s.symbol, s.expiration, s.strike,
       s.report_date, COALESCE(s.tier, s.profile) AS tier, s.premium,
       s.delta AS advertised_delta, q.mark AS entry_mark_per_share,
       q.delta AS entry_delta, q.implied_volatility AS entry_iv
FROM opt.telegram_signal s
LEFT JOIN opt.telegram_entry_quote q
  ON q.contract_key = s.contract_key AND q.report_date = s.report_date
WHERE s.is_current = 1 AND s.parse_status = 'parsed' AND s.option_right = 'P'
  AND s.expiration >= CAST(? AS date)
ORDER BY s.signal_key
"""


def discover(config: dict[str, str], day: date) -> list[dict]:
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
    with pyodbc.connect(connection_string, timeout=15) as connection:
        connection.timeout = 20
        cursor = connection.cursor()
        cursor.execute(QUERY, day.isoformat())
        columns = [column[0] for column in cursor.description]
        result = [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]
    for row in result:
        if not row["contract_key"] or not row["symbol"] or row["strike"] is None:
            raise ValueError("source contains an invalid contract identity")
        contract = Contract(
            str(row["contract_key"]), row["symbol"].upper(), row["expiration"], Decimal(str(row["strike"]))
        )
        _ = contract.occ
        row["contract"] = contract
    return result
