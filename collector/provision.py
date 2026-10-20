"""One-time, independently reviewed provisioning. Never called by the worker."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
from pathlib import Path
import secrets

import psycopg
from psycopg import sql

ROLES = ("sd_web_options_owner", "sd_web_options_migrator", "sd_web_options_runtime")


def verifier(password: str) -> str:
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 4096)
    client_key = hmac.digest(salted, b"Client Key", "sha256")
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.digest(salted, b"Server Key", "sha256")
    encoded = [base64.b64encode(value).decode() for value in (salt, stored_key, server_key)]
    return f"SCRAM-SHA-256$4096:{encoded[0]}${encoded[1]}:{encoded[2]}"


def provision(admin_passfile: str, secret_directory: str, migration: str, confirm: bool) -> None:
    secret_root = Path(secret_directory)
    with psycopg.connect(
        host="127.0.0.1",
        dbname="postgres",
        user="postgres",
        passfile=admin_passfile,
        autocommit=True,
        connect_timeout=10,
    ) as admin:
        if admin.execute("SHOW log_statement").fetchone()[0] != "none":
            raise ValueError("statement logging must be disabled before credential provisioning")
        if admin.execute("SHOW log_min_duration_statement").fetchone()[0] != "-1":
            raise ValueError("duration statement logging must be disabled")
        if admin.execute("SELECT 1 FROM pg_database WHERE datname='web_options'").fetchone():
            raise ValueError("database exists; inspect it rather than reprovisioning")
        if admin.execute("SELECT 1 FROM pg_roles WHERE rolname = ANY(%s)", (list(ROLES),)).fetchone():
            raise ValueError("collector role exists; inspect before retrying")
        hba = Path(admin.execute("SHOW hba_file").fetchone()[0])
        original = hba.read_text(encoding="utf-8-sig")
        if "sd_web_options_" in original:
            raise ValueError("collector HBA entries already exist; inspect before retrying")
        for role in ROLES[1:]:
            if (secret_root / f"{role}.pgpass").exists():
                raise ValueError("retained role credential already exists; do not replace it")
        print("Target: loopback PostgreSQL / web_options; new roles only; public schema; no existing DB changes")
        if not confirm:
            print("Dry run: no files or database objects changed")
            return
        if not secret_root.is_dir():
            raise ValueError("create and protect the secret directory first")
        # Only these new roles receive first-match rules; existing users retain their rules.
        allowed = ",".join(ROLES[1:])
        rules = (
            f"host web_options {allowed} 127.0.0.1/32 scram-sha-256\n"
            f"host web_options {allowed} ::1/128 scram-sha-256\n"
            f"host all {allowed} 0.0.0.0/0 reject\n"
            f"host all {allowed} ::0/0 reject\n"
            f"host replication {allowed} 0.0.0.0/0 reject\n"
            f"host replication {allowed} ::0/0 reject\n"
            f"local all {allowed} reject\n"
        )
        backup = hba.with_name("pg_hba.conf.before-web-options")
        with backup.open("x", encoding="utf-8", newline="\n") as output:
            output.write(original)
        # Rewriting in place preserves the existing file's ACL.
        hba.write_text(rules + original, encoding="utf-8", newline="\n")
        errors = admin.execute("SELECT error FROM pg_hba_file_rules WHERE error IS NOT NULL").fetchall()
        if errors:
            hba.write_text(original, encoding="utf-8", newline="\n")
            raise ValueError("HBA parse failed; original file restored")
        if not admin.execute("SELECT pg_reload_conf()").fetchone()[0]:
            raise ValueError("PostgreSQL configuration reload failed")
        admin.execute("CREATE ROLE sd_web_options_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE")
        admin.execute("CREATE ROLE sd_web_options_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE")
        admin.execute("CREATE ROLE sd_web_options_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE")
        admin.execute("GRANT sd_web_options_owner TO sd_web_options_migrator")
        admin.execute("CREATE DATABASE web_options OWNER sd_web_options_owner")
        admin.execute("REVOKE ALL ON DATABASE web_options FROM PUBLIC")
        admin.execute("GRANT CONNECT ON DATABASE web_options TO sd_web_options_migrator,sd_web_options_runtime")
        for role in ROLES[1:]:
            password = secrets.token_urlsafe(40)
            path = secret_root / f"{role}.pgpass"
            with path.open("x", encoding="utf-8", newline="\n") as output:
                output.write(f"127.0.0.1:5432:web_options:{role}:{password}\n")
            admin.execute(
                sql.SQL("ALTER ROLE {} PASSWORD {}").format(sql.Identifier(role), sql.Literal(verifier(password)))
            )
        with psycopg.connect(
            host="127.0.0.1",
            dbname="web_options",
            user=ROLES[1],
            passfile=str(secret_root / f"{ROLES[1]}.pgpass"),
            connect_timeout=10,
        ) as connection:
            connection.execute(Path(migration).read_text(encoding="utf-8"))
        print("Provisioned web_options and schema version 1; retained protected role credentials")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--admin-passfile", required=True)
    parser.add_argument("--secrets", required=True)
    parser.add_argument("--migration", required=True)
    parser.add_argument("--confirm", action="store_true")
    args = parser.parse_args()
    try:
        provision(args.admin_passfile, args.secrets, args.migration, args.confirm)
    except Exception as error:
        raise SystemExit(
            f"provisioning failed: {type(error).__name__}; inspect retained objects and private files"
        ) from None
