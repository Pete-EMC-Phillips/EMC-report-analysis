"""
Generates a small synthetic EMC test report PDF (sample/sample-emc-report.pdf)
with known radiated/conducted emissions data, for testing and demoing the
EMC Report Analyzer parser. Not a real test report.

Usage: python3 generate_sample_report.py <output_path>
"""
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
)

OUT = sys.argv[1] if len(sys.argv) > 1 else "sample-emc-report.pdf"

styles = getSampleStyleSheet()
story = []

def h1(text):
    story.append(Paragraph(text, styles["Heading1"]))

def h2(text):
    story.append(Paragraph(text, styles["Heading2"]))

def body(text):
    story.append(Paragraph(text, styles["BodyText"]))

def table(headers, rows):
    data = [headers] + rows
    t = Table(data, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dddddd")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(t)

# --- Cover page ---
h1("EMC Test Report (SAMPLE / SYNTHETIC DATA)")
body("Product Under Test: Demo Widget 3000")
body("Report Number: SAMPLE-2026-001")
body("This is a synthetically generated sample report used only to test the "
     "EMC Report Analyzer web application's parsing logic. Values are made up "
     "and do not correspond to a real product.")
story.append(PageBreak())

# --- Test setup narrative page (should mostly be "unmatched" prose) ---
h2("1. Test Configuration")
body("The equipment under test (EUT) was configured in a typical use "
     "configuration as described in section 4 of this report. All cables "
     "were routed per the manufacturer's installation instructions. "
     "Ambient temperature was 23 degrees C and relative humidity was 45%.")
body("Test site: Semi-anechoic chamber, 3 m measurement distance, validated "
     "per ANSI C63.4.")
story.append(PageBreak())

# --- Radiated Emissions section ---
h2("5.2 Radiated Emissions (CISPR 32 Class B, EN 55032)")
body("Measurements performed per CISPR 16-1-1/16-2-3, 3 m semi-anechoic chamber, "
     "quasi-peak (QP) detector unless noted. Limit shown is the applicable "
     "Class B limit at the measurement distance.")
table(
    ["Frequency", "Level", "Limit", "Margin", "Det", "Result"],
    [
        ["30.000 MHz", "28.5 dBuV/m", "40.0 dBuV/m", "11.5 dB", "QP", "PASS"],
        ["54.000 MHz", "35.2 dBuV/m", "40.0 dBuV/m", "4.8 dB", "QP", "PASS"],
        ["98.500 MHz", "41.3 dBuV/m", "40.0 dBuV/m", "-1.3 dB", "QP", "FAIL"],
        ["150.000 MHz", "30.1 dBuV/m", "40.0 dBuV/m", "9.9 dB", "QP", "PASS"],
        ["433.920 MHz", "38.9 dBuV/m", "40.0 dBuV/m", "1.1 dB", "QP", "PASS"],
        ["960.000 MHz", "44.0 dBuV/m", "40.0 dBuV/m", "-4.0 dB", "QP", "FAIL"],
        ["2440.000 MHz", "46.5 dBuV/m", "40.0 dBuV/m", "-6.5 dB", "QP", "FAIL"],
        ["5800.000 MHz", "39.0 dBuV/m", "45.0 dBuV/m", "6.0 dB", "PK", "PASS"],
    ],
)
story.append(Spacer(1, 12))
body("Note: worst-case frequencies only are reported above; full spectrum "
     "plots are provided in Appendix C (not included in this sample).")
story.append(PageBreak())

# --- Conducted Emissions section ---
h2("5.3 Conducted Emissions (CISPR 32 Class B, EN 55032)")
body("Measurements performed on the AC mains port using a LISN, "
     "quasi-peak (QP) detector, 0.15-30 MHz.")
table(
    ["Frequency", "Level", "Limit", "Margin", "Det", "Result"],
    [
        ["0.150 MHz", "60.0 dBuV", "66.0 dBuV", "6.0 dB", "QP", "PASS"],
        ["0.500 MHz", "58.0 dBuV", "56.0 dBuV", "-2.0 dB", "QP", "FAIL"],
        ["5.000 MHz", "45.0 dBuV", "60.0 dBuV", "15.0 dB", "QP", "PASS"],
        ["30.000 MHz", "48.0 dBuV", "60.0 dBuV", "12.0 dB", "QP", "PASS"],
    ],
)
story.append(PageBreak())

# --- Filler pages to pad page count a bit and test robustness ---
for i in range(3):
    h2(f"Appendix {chr(65+i)} — Photographs / Setup (placeholder)")
    body("This page intentionally contains only narrative text and no "
         "measurement tables, to verify the parser correctly skips non-table "
         "content without producing false positives.")
    story.append(PageBreak())

doc = SimpleDocTemplate(OUT, pagesize=A4,
                         leftMargin=20*mm, rightMargin=20*mm,
                         topMargin=18*mm, bottomMargin=18*mm)
doc.build(story)
print(f"Wrote {OUT}")
