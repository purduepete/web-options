"""Post-provisioning isolation checks; no persistent writes."""

from __future__ import annotations

import argparse
from pathlib import Path

import psycopg

from .provision import ROLES


def verify(admin_passfile: str, secret_directory: str) -> None:
    with psycopg.connect(
        host="127.0.0.1",
        hostaddr="127.0.0.1",
        sslmode="prefer",
        gssencmode="disable",
        dbname="postgres",
        user="postgres",
        passfile=admin_passfile,
    ) as admin:
        databases = [
            row[0]
            for row in admin.execute(
                "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate"
            ).fetchall()
        ]
        if admin.execute("SELECT error FROM pg_hba_file_rules WHERE error IS NOT NULL").fetchall():
            raise ValueError("HBA has parsing errors")
    for role in ROLES[1:]:
        content = (Path(secret_directory) / f"{role}.pgpass").read_text().strip()
        password = content.split(":", 4)[4]
        for host in ("127.0.0.1", "::1"):
            for database in databases:
                try:
                    with psycopg.connect(
                        host=host,
                        hostaddr=host,
                        sslmode="prefer",
                        gssencmode="disable",
                        dbname=database,
                        user=role,
                        password=password,
                        connect_timeout=5,
                        autocommit=True,
                    ) as connection:
                        if database != "web_options":
                            raise ValueError("cross-database authentication unexpectedly succeeded")
                        if role == ROLES[2]:
                            row = connection.execute("""
                                SELECT has_schema_privilege(current_user,'public','CREATE'),
                                       pg_has_role(current_user,'sd_web_options_owner','MEMBER'),
                                       has_table_privilege(current_user,'public.collector_schema','INSERT'),
                                       has_table_privilege(current_user,'public.option_quote','DELETE'),
                                       has_table_privilege(current_user,'public.option_quote','INSERT')
                            """).fetchone()
                            if row != (False, False, False, False, True):
                                raise ValueError("runtime privileges do not match the approved policy")
                            version = connection.execute("SELECT version FROM public.collector_schema").fetchone()
                            if version != (1,):
                                raise ValueError("unexpected schema version")
                except psycopg.OperationalError as error:
                    # Check reason without printing the authentication exception or credentials.
                    if database == "web_options" or "pg_hba.conf rejects connection" not in str(error):
                        raise ValueError("authentication probe did not prove explicit HBA rejection") from None
        print(f"{role}: own database works on IPv4/IPv6; every other database explicitly rejected")
    print("Runtime DDL, owner membership, schema-ledger writes and DELETE denied; quote INSERT allowed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--admin-passfile", required=True)
    parser.add_argument("--secrets", required=True)
    args = parser.parse_args()
    try:
        verify(args.admin_passfile, args.secrets)
    except Exception as error:
        raise SystemExit(f"database verification failed: {type(error).__name__}; do not activate collector") from None
