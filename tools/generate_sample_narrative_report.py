"""
Generates a second synthetic sample PDF that mimics the "narrative sentence"
EMC report style used by some automotive labs (e.g. JLR CISPR 25 / RE 310
reports produced with EMC32-family software): each radiated-emissions
frequency sweep is a graph, and the only machine-readable result is a prose
sentence like "PK level exceeded the range 243 - 650 MHz with max.
exceedance 8.13 dB at 571.8 MHz." rather than a level/limit table.

This directly reproduces the real bug reported against the app: the generic
table-row parser was misreading the end of the swept range (650 MHz) as the
measurement frequency, and turning "8.13 dB" / "571.8" into a bogus
level/limit pair instead of treating them as "exceeded by 8.13 dB at 571.8
MHz".

Usage: python3 generate_sample_narrative_report.py <output_path>
"""
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak

OUT = sys.argv[1] if len(sys.argv) > 1 else "sample-narrative-report.pdf"

styles = getSampleStyleSheet()
story = []


def h2(text):
    story.append(Paragraph(text, styles["Heading2"]))


def body(text):
    story.append(Paragraph(text, styles["BodyText"]))


def plot_page(test_id, file_ref, freq_setting, antenna, result, narrative_lines):
    h2(f"Test {test_id}")
    body("Radiated RF Emissions (RE 310)")
    body("DUT 1, operating mode: Torque mode 10 Nm, unit 13000 rpm, 800 V")
    body("Settings:")
    body(f"- f: {freq_setting}")
    body("- Det.: PK / AV")
    body("- BW: 120 kHz")
    body("- T: 500 ms")
    body(f"Antenna: {antenna}")
    body(f"File: {file_ref}")
    body("PK level: Black trace, AV level: Green trace")
    body("Limits according to Sample_EMC_CS v1.0:")
    body(f"Result: {result}.")
    for line in narrative_lines:
        body(line)
    story.append(PageBreak())


# This is the exact case reported as a bug: page should yield frequency
# 571.8 MHz and a -8.13 dB margin, NOT 650 MHz / a bogus level-limit split.
plot_page(
    "1.1.181", "RE_72b", "200-1000 MHz", "Horizontal", "Not compliant",
    ["PK level exceeded the range 243 – 650 MHz with max. exceedance 8.13 dB at 571.8 MHz."],
)

# No-range variant.
plot_page(
    "1.1.68", "RE_28c", "65-176 MHz", "Horizontal", "Not compliant",
    ["PK level exceeded at 316 MHz with exceedance 2.4 dB."],
)

# Two disjoint ranges variant, two detectors.
plot_page(
    "1.1.100", "RE_42c", "65-176 MHz", "Vertical", "Not compliant",
    ["PK level exceeded the ranges 65 – 66 MHz and 106-108 MHz with max. exceedance 2.9 dB at 107.25 MHz."],
)

# Compliant page where PK still nominally "exceeds" a reference line but the
# formal Result is Compliant (QP/AV govern) - should NOT count as a failure.
plot_page(
    "1.1.195", "RE_81c", "65-176 MHz", "Vertical", "Compliant",
    ["PK level exceeded the range 65 – 109 MHz with max. exceedance 2.6 dB at 108 MHz.",
     "AV level exceeded with exceedance 0.61 dB at 108 MHz."],
)

# A clean pass with no exceedance narrative at all.
plot_page(
    "1.1.50", "RE_17a", "30-200 MHz", "Vertical", "Compliant",
    ["Ambient noise more than 6 dB below the limits."],
)

doc = SimpleDocTemplate(OUT, pagesize=A4,
                         leftMargin=20 * mm, rightMargin=20 * mm,
                         topMargin=18 * mm, bottomMargin=18 * mm)
doc.build(story)
print(f"Wrote {OUT}")
