import copy
from datetime import date
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
import zipfile

SPEC = importlib.util.spec_from_file_location("wrapup_import", Path(__file__).parents[1] / "tools" / "import_weekly_wrapup.py")
IMPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORT)
URL = "https://example.com/report"


def fixture_rows():
    return {
        "Management Plan": [
            ["Management Plan - Week of November 9 - November 13, 2026"],
            ["Prices are Friday, November 6 closes."],
            list(IMPORT.HEADERS["management"]),
            ["RED", "HOLD", "Review", "TEST", "1", "$100P", "01/15", "~$95", "-25.0%", "-0.5", "Example guidance"],
            ["RED", "HOLD", "Review", "TEST", "1", "$100P", "01/15", "~$95", "-26.0%", "-0.5", "Distinct entry context"],
            ["GREEN", "ORDER IN", "Review", "CALL", "1", "$100C", "11/20", "$105", "+50%", "0.5", "Excluded guidance"],
            ["Total: mixed puts and calls"],
        ],
        "Closed Trades": [
            ["Week of November 2 - November 6, 2026"],
            list(IMPORT.HEADERS["closed"]),
            ["1", "TEST", "1", "$90P", "12/18", "11/06", "$3", "$1", "+66.7%", "0"],
            ["2", "CALL", "1", "$90C", "12/18", "11/06", "$3", "$1", "+66.7%", "0"],
            ["Total: mixed"],
            ["CONTROLLED EXITS (Roll Close-Legs)"],
            list(IMPORT.HEADERS["controlled"]),
            ["1", "TEST", "1", "$100P Nov 20", "$95P Dec 24", "Example", "-$23.00", "-0.7 -> -0.4", "Roll Close-Leg"],
        ],
        "Rolls": [
            ["Week of November 2 - November 6, 2026"],
            list(IMPORT.HEADERS["rolls"]),
            ["1", "TEST", "1", "$100P Nov 20", "$95P Dec 24", "-$23", "-0.7 -> -0.4", "-$14"],
            ["Total: mixed"],
        ],
    }


def xlsx(rows, no_cache=False):
    buffer = io.BytesIO()
    namespace = IMPORT.NS["s"]
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        workbook = ET.Element(f"{{{namespace}}}workbook")
        sheets = ET.SubElement(workbook, f"{{{namespace}}}sheets")
        relationships = ET.Element("Relationships")
        for index, (name, sheet_rows) in enumerate(rows.items(), 1):
            ET.SubElement(sheets, f"{{{namespace}}}sheet", {"name": name, IMPORT.REL: str(index)})
            ET.SubElement(relationships, "Relationship", {"Id": str(index), "Target": f"worksheets/sheet{index}.xml"})
            worksheet = ET.Element(f"{{{namespace}}}worksheet")
            data = ET.SubElement(worksheet, f"{{{namespace}}}sheetData")
            for number, values in enumerate(sheet_rows, 1):
                row = ET.SubElement(data, f"{{{namespace}}}row", {"r": str(number)})
                for column, value in enumerate(values):
                    cell = ET.SubElement(row, f"{{{namespace}}}c", {"r": f"{chr(65 + column)}{number}", "t": "inlineStr"})
                    inline = ET.SubElement(cell, f"{{{namespace}}}is")
                    ET.SubElement(inline, f"{{{namespace}}}t").text = value
                    if no_cache and name == "Management Plan" and number == 4 and column == 9:
                        ET.SubElement(cell, f"{{{namespace}}}f").text = "1+1"
            archive.writestr(f"xl/worksheets/sheet{index}.xml", ET.tostring(worksheet))
        archive.writestr("xl/workbook.xml", ET.tostring(workbook))
        archive.writestr("xl/_rels/workbook.xml.rels", ET.tostring(relationships))
    return buffer.getvalue()


class ImportTests(unittest.TestCase):
    def test_selected_tabs_puts_only_and_source_rows_preserved(self):
        source = fixture_rows()
        source["Weekly Overview"] = [["ignored"]]
        source["Disclaimer"] = [["ignored"]]
        report = IMPORT.normalize(xlsx(source), URL)
        self.assertEqual(set(report["sections"]), {"management", "closed", "rolls"})
        management = report["sections"]["management"]
        rows = management["tables"][0]["rows"]
        self.assertEqual(len(rows), 2)
        self.assertEqual([row["sourceRow"] for row in rows], [4, 5])
        self.assertNotEqual(rows[0]["cells"][-1], rows[1]["cells"][-1])
        self.assertEqual(rows[0]["contract"]["expiration"], "2027-01-15")
        self.assertEqual(management["quoteDate"], "2026-11-06")
        self.assertEqual(management["audit"]["calls"], [6])
        self.assertEqual(report["sections"]["closed"]["tables"][1]["kind"], "controlled")
        serialized = json.dumps(report)
        self.assertNotIn("Excluded guidance", serialized)
        self.assertNotIn("Total: mixed", serialized)
        for section in report["sections"].values():
            used = section["headerRows"] + section["audit"]["calls"] + section["audit"]["notes"]
            used += [row["sourceRow"] for table in section["tables"] for row in table["rows"]]
            self.assertEqual(len(set(used)), section["sourceRows"])

    def test_put_to_call_roll_is_excluded(self):
        source = fixture_rows()
        source["Rolls"][2][4] = "$95C Dec 24"
        report = IMPORT.normalize(xlsx(source), URL)
        self.assertEqual(report["sections"]["rolls"]["tables"][0]["rows"], [])
        self.assertEqual(report["sections"]["rolls"]["audit"]["calls"], [3])

    def test_missing_selected_sheet_fails_but_unselected_sheets_are_optional(self):
        IMPORT.normalize(xlsx(fixture_rows()), URL)
        source = fixture_rows()
        del source["Rolls"]
        with self.assertRaisesRegex(ValueError, "must contain"):
            IMPORT.normalize(xlsx(source), URL)

    def test_changed_header_malformed_put_and_missing_formula_cache_fail(self):
        for replacement in ["$100X", "", "$0P"]:
            source = fixture_rows()
            source["Management Plan"][3][5] = replacement
            with self.assertRaisesRegex(ValueError, "row 4"):
                IMPORT.normalize(xlsx(source), URL)
        source = fixture_rows()
        source["Management Plan"][2][0] = "Unknown"
        with self.assertRaisesRegex(ValueError, "header"):
            IMPORT.normalize(xlsx(source), URL)
        with self.assertRaisesRegex(ValueError, "cached value"):
            IMPORT.normalize(xlsx(fixture_rows(), no_cache=True), URL)

    def test_dates_never_depend_on_host_clock(self):
        self.assertEqual(IMPORT.yearless("01/15", date(2026, 11, 6), 1), date(2027, 1, 15))
        self.assertEqual(IMPORT.yearless("12/30", date(2027, 1, 8), -1), date(2026, 12, 30))
        self.assertEqual(IMPORT.yearless("11/06", date(2026, 11, 6), -1), date(2026, 11, 6))
        with self.assertRaises(ValueError):
            IMPORT.yearless("02/30", date(2026, 11, 6), 1)

    def test_invalid_units_and_dates_fail(self):
        for column, replacement in [(8, "unknown%"), (9, "-2"), (6, "invalid"), (4, "0")]:
            source = fixture_rows()
            source["Management Plan"][3][column] = replacement
            with self.assertRaises(ValueError):
                IMPORT.normalize(xlsx(source), URL)

    def test_size_limits_and_entities(self):
        with self.assertRaisesRegex(ValueError, "10 MiB"):
            IMPORT.workbook_rows(b" " * (IMPORT.MAX_FILE + 1))
        with patch.object(IMPORT, "MAX_EXPANDED", 1):
            with self.assertRaisesRegex(ValueError, "expanded"):
                IMPORT.normalize(xlsx(fixture_rows()), URL)
        with self.assertRaisesRegex(ValueError, "entities"):
            IMPORT.xml(b'<!DOCTYPE a [<!ENTITY x "x">]><a>&x;</a>')
        with self.assertRaisesRegex(ValueError, "entities"):
            IMPORT.xml('<!DOCTYPE a [<!ENTITY x "x">]><a>&x;</a>'.encode("utf-16"))

    def test_atomic_repeat_replace_restart_and_failure_preservation(self):
        report = IMPORT.normalize(xlsx(fixture_rows()), URL)
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(IMPORT.publish(report, directory), "written")
            destination = Path(directory) / f"{report['id']}.json"
            original = destination.read_bytes()
            self.assertEqual(IMPORT.publish(report, directory), "unchanged")
            changed = copy.deepcopy(report)
            changed["sourceHash"] = "b" * 64
            with self.assertRaisesRegex(ValueError, "--replace"):
                IMPORT.publish(changed, directory)
            with patch.object(IMPORT.os, "replace", side_effect=OSError("interrupted")):
                with self.assertRaisesRegex(OSError, "interrupted"):
                    IMPORT.publish(changed, directory, replace=True)
            self.assertEqual(destination.read_bytes(), original)
            self.assertEqual(list(Path(directory).glob("*.tmp")), [])
            self.assertEqual(IMPORT.publish(changed, directory, replace=True), "written")
            self.assertEqual(json.loads(destination.read_text())["sourceHash"], "b" * 64)

    def test_empty_puts_is_valid_only_with_valid_tables(self):
        source = fixture_rows()
        for name, sheet in source.items():
            source[name] = [row for row in sheet if not any("P" in value and "$" in value for value in row)]
        report = IMPORT.normalize(xlsx(source), URL)
        self.assertTrue(all(not table["rows"] for section in report["sections"].values() for table in section["tables"]))


if __name__ == "__main__":
    unittest.main()
