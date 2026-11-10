"""Read selected XLSX tables without executing spreadsheet content."""

import argparse
import calendar
from datetime import date, datetime
import hashlib
import io
import json
import math
import os
from pathlib import Path
import posixpath
import re
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET

MAX_FILE = 10 * 1024 * 1024
MAX_EXPANDED = 40 * 1024 * 1024
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
MONTHS = {name.lower(): i for i in range(1, 13) for name in (calendar.month_name[i], calendar.month_abbr[i])}
HEADERS = {
    "management": ["Zone", "This Week", "Category", "Ticker", "Contracts", "Position", "Exp", "Stock", "P&L %", "Delta", "Management Plan"],
    "closed": ["#", "Ticker", "Contracts", "Position", "Exp", "Opened", "Entry", "Exit", "P&L %", "Days Held"],
    "controlled": ["#", "Ticker", "Contracts", "Old Position", "New Position", "Reason", "Close-Leg P&L", "Delta Change", "Type"],
    "rolls": ["#", "Ticker", "Contracts", "Old Position", "New Position", "Close-Leg P&L", "Delta Change", "Roll Txn Net"],
}
SHEETS = {"management": "Management Plan", "closed": "Closed Trades", "rolls": "Rolls"}
POSITION = re.compile(r"\$?(\d+(?:\.\d+)?)([PC])", re.I)
DEFAULT_DIRECTORY = Path(r"C:\ProgramData\SolutionDeploy\apps\web-options\shared\weekly-wrapups")


class DataOnlyTreeBuilder(ET.TreeBuilder):
    def doctype(self, name, pubid, system):
        raise ValueError("XML declarations with entities are not supported")


def xml(data):
    # Reject every DTD through the parser, including UTF-16 encoded declarations.
    return ET.fromstring(data, parser=ET.XMLParser(target=DataOnlyTreeBuilder()))  # noqa: S314


def workbook_rows(data):
    if len(data) > MAX_FILE:
        raise ValueError("Workbook exceeds 10 MiB")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 2000 or sum(item.file_size for item in entries) > MAX_EXPANDED:
            raise ValueError("Workbook expanded size or entry count exceeds limits")
        if len({item.filename for item in entries}) != len(entries):
            raise ValueError("Workbook has duplicate ZIP entries")
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = [
                "".join(node.itertext())
                for node in xml(archive.read("xl/sharedStrings.xml")).findall("s:si", NS)
            ]
        relationships = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in xml(archive.read("xl/_rels/workbook.xml.rels"))
            if rel.attrib.get("TargetMode") != "External"
        }
        sheets = xml(archive.read("xl/workbook.xml")).findall("s:sheets/s:sheet", NS)
        result = {}
        for sheet in sheets:
            name = sheet.attrib["name"]
            if name not in SHEETS.values():
                continue
            if name in result:
                raise ValueError(f"Duplicate selected sheet: {name}")
            target = relationships[sheet.attrib[REL]]
            target = posixpath.normpath(target.lstrip("/") if target.startswith("/") else "xl/" + target)
            if not target.startswith("xl/worksheets/"):
                raise ValueError(f"Invalid worksheet relationship: {name}")
            rows = []
            seen = set()
            for row in xml(archive.read(target)).findall("s:sheetData/s:row", NS):
                row_number = int(row.attrib["r"])
                if row_number in seen or not 1 <= row_number <= 10000:
                    raise ValueError(f"Invalid or duplicate row in {name}")
                seen.add(row_number)
                cells = {}
                for cell in row.findall("s:c", NS):
                    ref = re.fullmatch(r"([A-Z]+)(\d+)", cell.attrib["r"])
                    if not ref or int(ref[2]) != row_number:
                        raise ValueError(f"Invalid cell reference in {name}")
                    column = 0
                    for letter in ref[1]:
                        column = column * 26 + ord(letter) - 64
                    if column > 40 or column in cells:
                        raise ValueError(f"Unsupported column in {name}")
                    value = cell.find("s:v", NS)
                    inline = cell.find("s:is", NS)
                    if cell.find("s:f", NS) is not None and (value is None or value.text is None):
                        raise ValueError(f"{name} {cell.attrib['r']}: formula has no cached value")
                    text = value.text if value is not None else "".join(inline.itertext()) if inline is not None else ""
                    text = text or ""
                    if cell.attrib.get("t") == "s":
                        text = strings[int(text)]
                    if cell.attrib.get("t") in ("e", "b"):
                        raise ValueError(f"{name} {cell.attrib['r']}: unsupported cell type")
                    if len(text) > 20000:
                        raise ValueError(f"{name}: cell text exceeds limit")
                    cells[column] = text.strip()
                values = [cells.get(i, "") for i in range(1, max(cells, default=0) + 1)]
                if any(values):
                    rows.append((row_number, values))
            result[name] = rows
        if set(result) != set(SHEETS.values()):
            raise ValueError("Workbook must contain Management Plan, Closed Trades, and Rolls")
        return result


def period(rows):
    text = "\n".join(values[0] for _, values in rows[:6] if values)
    match = re.search(r"Week of (\w+) (\d{1,2})\s*[-\u2013]\s*(?:(\w+) )?(\d{1,2}), (\d{4})", text)
    if not match:
        raise ValueError("Missing or unsupported source week")
    year = int(match[5])
    start_month = MONTHS[match[1].lower()]
    end_month = MONTHS[(match[3] or match[1]).lower()]
    start = date(year - (start_month > end_month), start_month, int(match[2]))
    end = date(year, end_month, int(match[4]))
    if not 0 <= (end - start).days <= 6:
        raise ValueError("Invalid source week range")
    return start, end, text


def yearless(value, anchor, direction):
    match = re.fullmatch(r"(\d{1,2})/(\d{1,2})(?:/(\d{4}))?", value)
    if not match:
        raise ValueError(f"Unsupported date {value!r}; expected month/day or month/day/year")
    candidates = []
    for year in [int(match[3])] if match[3] else range(anchor.year - 1, anchor.year + 2):
        try:
            candidate = date(year, int(match[1]), int(match[2]))
        except ValueError:
            continue
        days = (candidate - anchor).days * direction
        if 0 <= days < 365:
            candidates.append(candidate)
    if len(candidates) != 1:
        raise ValueError(f"Ambiguous or out-of-range date {value!r}; provide an explicit year")
    return candidates[0]


def leg(value, symbol, anchor, expiration=None):
    if expiration is None:
        match = re.fullmatch(r"(\$?\d+(?:\.\d+)?[PC])\s+(\w+)\s+(\d{1,2})(?:,?\s+(\d{4}))?", value, re.I)
        if not match or match[2].lower() not in MONTHS:
            raise ValueError(f"Unsupported roll position {value!r}")
        position = match[1]
        expiration = f"{MONTHS[match[2].lower()]}/{match[3]}" + (f"/{match[4]}" if match[4] else "")
    else:
        position = value
    parsed = POSITION.fullmatch(position.strip())
    if not parsed or not math.isfinite(float(parsed[1])) or float(parsed[1]) <= 0:
        raise ValueError(f"Ambiguous position {position!r}")
    return {
        "symbol": symbol, "strike": float(parsed[1]), "optionRight": parsed[2].upper(),
        "expiration": yearless(expiration, anchor, 1).isoformat(),
    }


def numeric(value, percent=False, integer=False, nonnegative=False):
    if percent and not value.endswith("%"):
        raise ValueError(f"Percentage must include its unit: {value!r}")
    cleaned = value.removesuffix("%") if percent else value.replace("$", "").replace(",", "").removeprefix("~")
    if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?", cleaned):
        raise ValueError(f"Unsupported numeric value {value!r}")
    number = float(cleaned)
    if not math.isfinite(number):
        raise ValueError(f"Non-finite numeric value {value!r}")
    if (integer and number != int(number)) or (nonnegative and number < 0):
        raise ValueError(f"Invalid numeric value {value!r}")
    return number


def normalize_table_row(kind, row_number, values, start, end, quote):
    headers = HEADERS[kind]
    if len(values) > len(headers) and any(values[len(headers):]):
        raise ValueError("Unexpected populated columns")
    values = (values + [""] * len(headers))[:len(headers)]
    fields = dict(zip(headers, values))
    symbol = fields["Ticker"]
    if not re.fullmatch(r"[A-Z][A-Z0-9.^-]{0,15}", symbol):
        raise ValueError(f"Invalid ticker {symbol!r}")
    if numeric(fields["Contracts"], integer=True, nonnegative=True) <= 0:
        raise ValueError("Contracts must be a positive integer")
    is_roll = kind in ("controlled", "rolls")
    anchor = quote or start
    position = leg(fields["Old Position"] if is_roll else fields["Position"], symbol, anchor, None if is_roll else fields["Exp"])
    new_position = leg(fields["New Position"], symbol, anchor) if is_roll else None
    if position["optionRight"] == "C" or (new_position and new_position["optionRight"] == "C"):
        return None
    if is_roll:
        for column in ("Close-Leg P&L", "Roll Txn Net"):
            if column in fields:
                numeric(fields[column])
        for column, item in (("Old Position", position), ("New Position", new_position)):
            fields[column] = f"${item['strike']:g}P {item['expiration']}"
    else:
        fields["Exp"] = position["expiration"]
        if kind == "closed":
            opened = yearless(fields["Opened"], end, -1)
            if opened.isoformat() > position["expiration"]:
                raise ValueError("Opened date is after expiration")
            fields["Opened"] = opened.isoformat()
            for column in ("Entry", "Exit"):
                numeric(fields[column], nonnegative=True)
            numeric(fields["Days Held"], integer=True, nonnegative=True)
        else:
            numeric(fields["Stock"], nonnegative=True)
            delta = numeric(fields["Delta"])
            if not -1 <= delta <= 1:
                raise ValueError("Delta outside [-1, 1]")
        numeric(fields["P&L %"], percent=True)
    return {"sourceRow": row_number, "cells": [fields[header] for header in headers],
            "contract": position, "newContract": new_position}


def normalize(data, source_url):
    if not re.fullmatch(r"https://[^\s]+", source_url):
        raise ValueError("Source URL must be HTTPS")
    sheets = workbook_rows(data)
    sections = {}
    for key, name in SHEETS.items():
        rows = sheets[name]
        start, end, metadata = period(rows)
        quote = None
        if key == "management":
            match = re.search(r"Prices are \w+, (\w+) (\d{1,2}) closes", metadata)
            if not match or match[1].lower() not in MONTHS:
                raise ValueError("Missing or unsupported management quote date")
            quote = yearless(f"{MONTHS[match[1].lower()]}/{match[2]}", start, -1)
        tables = []
        current = None
        audit = {"calls": [], "notes": []}
        header_rows = []
        for number, values in rows:
            table_kind = next((kind for kind in (["closed", "controlled"] if key == "closed" else [key])
                               if values == HEADERS[kind]), None)
            if table_kind:
                if any(table["kind"] == table_kind for table in tables):
                    raise ValueError(f"{name}: duplicate table header")
                current = {"kind": table_kind, "headers": HEADERS[table_kind], "rows": []}
                tables.append(current)
                header_rows.append(number)
                continue
            if current is None:
                # Metadata ends before the first table. A changed header must not look like metadata.
                if "Ticker" in values or len([v for v in values if v]) > 1:
                    raise ValueError(f"{name} row {number}: unsupported header")
                audit["notes"].append(number)
                continue
            populated = [value for value in values if value]
            if len(populated) == 1 and (
                populated[0].startswith(("Total:", "CONTROLLED EXITS", "CALL-AWAY / ASSIGNMENT", "Execution date:"))
                or re.match(r"\d+ controlled exit", populated[0])
                or re.match(r"[A-Z][A-Z0-9.-]* \$\d+(?:\.\d+)?C ", populated[0])
            ):
                audit["notes"].append(number)
                continue
            try:
                item = normalize_table_row(current["kind"], number, values, start, end, quote)
            except ValueError as error:
                raise ValueError(f"{name} row {number}: {error}") from error
            if item is None:
                audit["calls"].append(number)
            else:
                current["rows"].append(item)
        if not tables or tables[0]["kind"] != key:
            raise ValueError(f"{name}: required table header missing")
        sections[key] = {"name": name, "start": start.isoformat(), "end": end.isoformat(),
                         "quoteDate": quote.isoformat() if quote else None, "tables": tables,
                         "audit": audit, "headerRows": header_rows, "sourceRows": len(rows)}
    return {"version": 1, "id": sections["closed"]["end"],
            "sourceUrl": source_url, "sourceHash": hashlib.sha256(data).hexdigest(),
            "importedAt": datetime.now().astimezone().isoformat(), "sections": sections}


def publish(report, directory, replace=False):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / f"{report['id']}.json"
    if destination.exists():
        prior = json.loads(destination.read_text(encoding="utf-8"))
        if prior["sourceHash"] == report["sourceHash"]:
            return "unchanged"
        if not replace:
            raise ValueError("Changed source for this report; inspect preview and use --replace with --confirm")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(report, stream, ensure_ascii=True, indent=2, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return "written"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY)
    parser.add_argument("--confirm", action="store_true", help="Publish after validation; otherwise preview only")
    parser.add_argument("--replace", action="store_true", help="Explicitly replace changed content for the same report")
    args = parser.parse_args(argv)
    if args.workbook.stat().st_size > MAX_FILE:
        raise ValueError("Workbook exceeds 10 MiB")
    report = normalize(args.workbook.read_bytes(), args.source_url)
    for section in report["sections"].values():
        print(f"{section['name']}: {sum(len(t['rows']) for t in section['tables'])} put rows, "
              f"{len(section['audit']['calls'])} call rows excluded, "
              f"{len(section['audit']['notes'])} metadata/summary rows excluded")
    print(f"Report {report['id']}; destination {args.directory.resolve()}")
    print(publish(report, args.directory, args.replace) if args.confirm else "Preview only; use --confirm to publish")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, IndexError, OSError, zipfile.BadZipFile, ET.ParseError) as error:
        print(f"Import failed: {error}", file=sys.stderr)
        sys.exit(1)
