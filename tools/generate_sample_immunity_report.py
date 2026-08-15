"""
Generates a small synthetic PDF mimicking an automotive immunity test
report (JLR/Mooser-style) that reports results as "Compliant"/"Deviation"
instead of Pass/Fail, per the real bug report this was built against:
some labs use "Deviation"/"Deviated" where others would say "Fail", and
put a front-matter dashboard table ("Tests to be done and results:")
ahead of the detailed per-test pages.

Usage: python3 generate_sample_immunity_report.py <output_path>
"""
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, PageBreak

OUT = sys.argv[1] if len(sys.argv) > 1 else "sample-immunity-report.pdf"

styles = getSampleStyleSheet()
story = []


def p(text):
    story.append(Paragraph(text, styles["BodyText"]))


def h(text):
    story.append(Paragraph(text, styles["Heading2"]))


# --- Page 1: front-matter dashboard ---
h("Tests to be done and results:")
p("Test Details Result DUT 1")
p("Radiated RF Emissions (RE 310) Informative")
p("Conducted Transient Emissions (CE 410) Compliant")
p("RF Immunity (RI 114) Compliant")
p("RF Immunity (RI 112) Deviation*)")
p("Continuous Disturbance CI 210 Compliant")
p("Transient CI 220 Deviation*)")
p("*) Evaluation will be done by customer.")
story.append(PageBreak())

# --- Page 2: RI 114 - passing individual test ---
h("2.1 RF Immunity (RI 114)")
p("Test 2.1.1 RF Immunity (RI 114)")
p("DUT 1, operating mode: Standby mode 0 Nm, unit 0 rpm, 700 V")
p("Settings:")
p("- f: 200-1000 MHz")
p("- E: 100 / 70 V/m")
p("File: RI_25")
p("Antenna: Vertical")
p("Result: Compliant")
story.append(PageBreak())

h("(section end)")
p("Test result:")
p("The tested sample fulfilled the specifications.")
p("No malfunction could be observed during and after the test.")
story.append(PageBreak())

# --- Page 3: RI 112 - failing individual test (BCI / Deviation) ---
h("2.3 RF Immunity (RI 112)")
p("Test 2.3.1 RF Immunity (RI 112)")
p("DUT 1, operating mode: SB")
p("Settings:")
p("- f: 0.1-30 MHz")
p("- I: 90-102 dBuA")
p("File: BCI_45")
p("Antenna: Vertical")
p("Result: Deviation")
p("Signal deviation of Pressure_OTP_01_kPa and T_OTP_01_degC")
story.append(PageBreak())

# --- Page 4: CI 220 - section-level failure summary (contraction form) ---
h("4.2 Transients CI 220")
p("Testing line: Power supply of EOBV")
p("Test result:")
p("The tested sample didn’t fulfill the specifications.")
p("Deviation during test with pulse C-2, E and F2.")
p("Evaluation will be done by customer.")
story.append(PageBreak())

doc = SimpleDocTemplate(OUT, pagesize=A4,
                         leftMargin=20 * mm, rightMargin=20 * mm,
                         topMargin=18 * mm, bottomMargin=18 * mm)
doc.build(story)
print(f"Wrote {OUT}")
