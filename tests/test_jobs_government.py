import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('jobs_government', Path(__file__).resolve().parents[1] / 'jobs-government.py')
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)
NOW = parser.date_value('10 October 2026')
URL = 'https://www.gov.za/test-circular.pdf'
ISSUE = 'PUBLIC SERVICE VACANCY CIRCULAR\nDATE ISSUED 09 OCTOBER 2026\n1'


def post(number, centre='Pretoria', extra=''):
    return f'''POST 36/{number} : TEST OFFICER REF NO: REF/{number}
SALARY : R237 453 - R279 708 per annum
CENTRE : {centre}
REQUIREMENTS : Relevant qualification
DUTIES : Advertised responsibilities
{extra}
'''


class GovernmentParserTests(unittest.TestCase):
    def parse(self, pages):
        return parser.parse_pages([ISSUE, *pages], URL, NOW)

    def test_department_boundary_resets_employer_and_default_deadline(self):
        page = '''ANNEXURE A
PROVINCIAL ADMINISTRATION: LIMPOPO
DEPARTMENT OF PUBLIC WORKS, ROADS AND INFRASTRUCTURE
CLOSING DATE : 06 November 2026 at 16h30
NOTE : First department instructions
''' + post(1) + '''
DEPARTMENT OF SOCIAL DEVELOPMENT
CLOSING DATE : 06 November 2026(Walk- in): 16h00 and (Online) :23H59
NOTE : Second department instructions
''' + post(2) + '\n2'
        rows = self.parse([page])['rows']
        self.assertEqual(len(rows), 2)
        self.assertIn('Public Works', rows[0]['employer'])
        self.assertIn('Social Development', rows[1]['employer'])
        self.assertNotEqual(rows[0]['closing'], rows[1]['closing'])
        self.assertEqual(rows[0]['closing'], parser.date_value('06 November 2026 at 16h30', True))
        self.assertEqual(rows[1]['closing'], parser.date_value('06 November 2026 at 16h00', True))

    def test_department_without_deadline_never_inherits_previous_employer_date(self):
        page = '''ANNEXURE A
PROVINCIAL ADMINISTRATION: TEST PROVINCE
DEPARTMENT OF EDUCATION
CLOSING DATE : 23 October 2026
NOTE : Instructions
''' + post(1) + '\nOFFICE OF THE PREMIER\n' + post(2)
        result = self.parse([page])
        self.assertEqual([r['id'] for r in result['rows']], ['2026-36/1'])
        self.assertEqual(result['diagnostics']['skipped']['ambiguous_or_missing_closing'], 1)

    def test_page_folios_and_markers_never_enter_fields_and_links_keep_start_page(self):
        page = '''ANNEXURE A
DEPARTMENT OF DEFENCE
CLOSING DATE : 23 October 2026 at 16h00
NOTE : Instructions
POST 36/1 : SENIOR SECRETARY
SALARY : R237 453 per annum
CENTRE : Pretoria
2'''
        rows = self.parse([page, 'REQUIREMENTS : Grade 12\nDUTIES : Work\n3'])['rows']
        self.assertEqual(rows[0]['location'], 'Pretoria')
        self.assertEqual(rows[0]['source_page'], 2)
        self.assertEqual(rows[0]['url'], URL + '#page=2')
        self.assertNotIn('@@PAGE', str(rows))

    def test_bare_and_channel_times_use_earliest_published_cutoff(self):
        self.assertEqual(parser.date_value('23 October 2026, 17:00 PM', True), parser.date_value('23 October 2026 at 17h00', True))
        self.assertEqual(parser.date_value('23 October 2026 at 16:00 (walk-in) and 23:59 (online)', True), parser.date_value('23 October 2026 at 16h00', True))
        self.assertEqual(parser.date_value('23 October 2026 at 12:00 am', True), parser.date_value('23 October 2026 at 00h00', True))
        self.assertIsNone(parser.date_value('23 October 2026 at 25:00', True))
        self.assertIsNone(parser.date_value('23 October 2026 or 26 October 2026', True))

    def test_job_specific_deadline_overrides_department_without_affecting_next_job(self):
        page = '''ANNEXURE A
DEPARTMENT OF HEALTH
CLOSING DATE : 23 October 2026
NOTE : Instructions
''' + post(1, extra='CLOSING DATE : 26 October 2026') + post(2)
        rows = self.parse([page])['rows']
        self.assertEqual(rows[0]['closing'], parser.date_value('26 October 2026', True))
        self.assertEqual(rows[1]['closing'], parser.date_value('23 October 2026', True))

    def test_multiple_salary_grades_remain_verbatim_without_invented_range(self):
        self.assertIsNone(parser.salary('Grade 1: R337 359 – R391 515 per annum Grade 2: R411 978 – R478 116 per annum'))
        self.assertEqual(parser.salary('R8 174.75 per month'), {'cur': 'ZAR', 'min': 8174.75, 'max': 8174.75, 'period': 'month'})

    def test_uppercase_title_continuation_survives_inline_reference(self):
        page = '''ANNEXURE A
DEPARTMENT OF PUBLIC WORKS
CLOSING DATE : 06 November 2026 at 16h30
NOTE : Instructions
POST 36/237 : GRADUATE INTERNSHIP PROGRAMME 2027/2029 REF NO: S.5/8/1/1/2
INFRASTRUCTURE MANAGEMENT (X3 POSTS)
Infrastructure Management Unit
STIPEND : R8 174.75 per month
CENTRE : Capricorn District
REQUIREMENTS : Relevant qualification
'''
        row = self.parse([page])['rows'][0]
        self.assertEqual(row['title'], 'GRADUATE INTERNSHIP PROGRAMME 2027/2029 INFRASTRUCTURE MANAGEMENT (X3 POSTS)')
        self.assertEqual(row['reference'], 'S.5/8/1/1/2')


if __name__ == '__main__':
    unittest.main()
