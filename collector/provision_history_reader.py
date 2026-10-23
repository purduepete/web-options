"""Operator-only dashboard reader provisioning; never called at app startup."""

from __future__ import annotations

import argparse
from pathlib import Path
import secrets

import psycopg
from psycopg import sql

from .provision import verifier

ROLE = "sd_web_options_reader"


def provision(admin_passfile: str, passfile: str, migration: str, confirm: bool) -> None:
    target = Path(passfile)
    with psycopg.connect(
        host="127.0.0.1", dbname="web_options", user="postgres",
        passfile=admin_passfile, autocommit=True, connect_timeout=10,
    ) as admin:
        if admin.execute("SHOW log_statement").fetchone()[0] != "none":
            raise ValueError("statement logging must be disabled")
        if admin.execute("SHOW log_min_duration_statement").fetchone()[0] != "-1":
            raise ValueError("duration logging must be disabled")
        if target.exists() or admin.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (ROLE,)).fetchone():
            raise ValueError("reader or credential exists; inspect before retrying")
        if admin.execute(
            """SELECT 1 FROM information_schema.table_privileges
               WHERE grantee='PUBLIC' AND table_schema='public' LIMIT 1"""
        ).fetchone():
            raise ValueError("PUBLIC table grants require separate review")
        hba = Path(admin.execute("SHOW hba_file").fetchone()[0])
        original = hba.read_text(encoding="utf-8-sig")
        if ROLE in original:
            raise ValueError("retained reader HBA rules require inspection")
        backup = hba.with_name("pg_hba.conf.before-history-reader")
        if backup.exists():
            raise ValueError("retained HBA backup requires inspection")
        if not confirm:
            print("Dry run: new reader only; column SELECT; loopback web_options only; no writes")
            return
        password = secrets.token_urlsafe(40)
        with target.open("x", encoding="utf-8", newline="\n") as output:
            output.write(f"127.0.0.1:5432:web_options:{ROLE}:{password}\n")
        admin.execute(Path(migration).read_text(encoding="utf-8"))
        admin.execute(sql.SQL("ALTER ROLE {} PASSWORD {}").format(
            sql.Identifier(ROLE), sql.Literal(verifier(password))
        ))
        backup.write_text(original, encoding="utf-8", newline="\n")
        rules = (
            f"host web_options {ROLE} 127.0.0.1/32 scram-sha-256\n"
            f"host web_options {ROLE} ::1/128 scram-sha-256\n"
            f"host all {ROLE} 0.0.0.0/0 reject\n"
            f"host all {ROLE} ::0/0 reject\n"
            f"host replication {ROLE} 0.0.0.0/0 reject\n"
            f"host replication {ROLE} ::0/0 reject\n"
            f"local all {ROLE} reject\n"
        )
        hba.write_text(rules + original, encoding="utf-8", newline="\n")
        if admin.execute("SELECT 1 FROM pg_hba_file_rules WHERE error IS NOT NULL").fetchone():
            hba.write_text(original, encoding="utf-8", newline="\n")
            raise ValueError("HBA parse failed; original restored")
        if not admin.execute("SELECT pg_reload_conf()").fetchone()[0]:
            raise ValueError("HBA reload failed; retained files require inspection")
        print("Reader provisioned; retained role credential and HBA backup. Verify isolation before activation.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--admin-passfile", required=True)
    parser.add_argument("--passfile", required=True)
    parser.add_argument("--migration", required=True)
    parser.add_argument("--confirm", action="store_true")
    args = parser.parse_args()
    try:
        provision(args.admin_passfile, args.passfile, args.migration, args.confirm)
    except Exception as error:
        raise SystemExit(f"reader provisioning failed: {type(error).__name__}; inspect retained objects") from None
