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
                            versions = {
                                row[0] for row in connection.execute(
                                    "SELECT version FROM public.collector_schema"
                                ).fetchall()
                            }
                            if versions != {1, 2}:
                                raise ValueError("unexpected schema version")
                            if 2 in versions:
                                invalid = connection.execute("""
                                    SELECT count(*) FROM (
                                      VALUES ('broker_contract',false),('option_owner',true),
                                             ('broker_option_quote',true),('option_capture_owner',false),
                                             ('broker_quote_diagnostic',false),('azure_option_observation',false)
                                    ) AS expected(name,can_update)
                                    WHERE NOT has_table_privilege(current_user,'public.' || name,'SELECT')
                                       OR NOT has_table_privilege(current_user,'public.' || name,'INSERT')
                                       OR has_table_privilege(current_user,'public.' || name,'UPDATE') <> can_update
                                       OR has_table_privilege(current_user,'public.' || name,'DELETE')
                                       OR has_table_privilege(current_user,'public.' || name,'TRUNCATE')
                                       OR EXISTS (
                                           SELECT 1 FROM pg_tables t WHERE t.schemaname='public'
                                           AND t.tablename=name AND t.tableowner=current_user
                                       )
                                """).fetchone()[0]
                                if invalid:
                                    raise ValueError("combined collector runtime privileges are incorrect")
                                columns = connection.execute("""
                                    SELECT count(*) FROM information_schema.columns
                                    WHERE table_schema='public' AND table_name='broker_contract'
                                      AND has_column_privilege(current_user,
                                          'public.broker_contract',column_name,'UPDATE')
                                          <> (column_name='synced_at')
                                """).fetchone()[0]
                                if columns:
                                    raise ValueError("broker contract UPDATE must be limited to synced_at")
                                validated = connection.execute("""
                                    SELECT convalidated FROM pg_constraint
                                    WHERE conrelid='public.option_collection_run'::regclass
                                      AND conname='option_collection_run_capture_kind_check'
                                """).fetchone()
                                if validated != (True,):
                                    raise ValueError("capture-kind constraint validation must finish before activation")
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
