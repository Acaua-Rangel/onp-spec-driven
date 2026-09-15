// Benchmark scenarios — REAL specs from the ONP domain (Vitor Manoel's
// programming course) with seeded defects, each representing a failure that
// really plagues spec-driven projects.
//
// Each scenario describes the SAME feature in a neutral way; the adapters
// materialize it in each tool's format. The `defectClass` column is the axis
// of comparison: how many tools mechanically detect each class.
 
// Defect classes (the "what actually goes wrong")
export const DEFECT_CLASSES = {
  CLEAN_BASELINE: 'correct spec — no tool should raise a false positive',
  REQ_NO_TEST: 'requirement with no test that proves it (SDD drift #1)',
  ORPHAN_TEST: 'requirement renamed; test was left behind pointing to the old ID',
  INCOMPLETE_REQ: 'requirement with no observable behavior (no Given/When/Then)',
  PREMATURE_DONE: 'task marked done with no proof of a passing test',
  SILENT_ASSUMPTION: 'product decision assumed with no explicit record',
  PRIVACY_VIOLATED: "student grade exposed / PII in a log — violates the constitution",
  ORPHAN_CODE: 'code file that serves no requirement at all',
  BROKEN_REF: 'task references a requirement that doesn\'t exist',
  DUPLICATE_ID: 'two requirements with the same identifier',
};

// Real feature 1: class enrollment (ONP course's August cohort)
const enrollmentBase = {
  feature: 'class-enrollment',
  title: 'Class enrollment',
  purpose:
    'Let a new student enroll in an open class, respecting the seat limit and recording the guardian\'s consent when the student is a minor.',
  stories: [
    {
      id: 'US-001',
      title: 'Student enrolls in an open class',
      as: 'interested visitor',
      want: 'enroll in a class with open seats',
      so: 'I secure my spot in the course',
      acs: [
        {
          id: 'AC-001',
          title: 'Enrollment in a class with a seat available',
          given: 'an open class with available seats',
          when: 'the visitor submits a valid name, email and phone number',
          then: 'the enrollment is recorded and the seat count is decremented',
        },
        {
          id: 'AC-002',
          title: 'Full class refuses enrollment',
          given: 'a class with no seats left',
          when: 'the visitor tries to enroll',
          then: 'the enrollment is refused with a "class full" message',
        },
      ],
    },
  ],
  assumptions: [
    { id: 'ASM-001', text: 'Email is the student\'s unique identifier', status: 'confirmed', resolution: 'decided with the product owner' },
  ],
  questions: [],
  constitution: false,
};

// Real feature 2: student grades (privacy-sensitive — LGPD)
const gradesBase = {
  feature: 'student-grades',
  title: 'Student grades',
  purpose:
    'Show the student their own grades and feedback, recording who accessed each grade, without ever exposing one student\'s grade to another.',
  stories: [
    {
      id: 'US-010',
      title: 'Student views their own grades',
      as: 'authenticated student',
      want: 'see my grades and feedback',
      so: 'I can track my progress',
      acs: [
        {
          id: 'AC-010',
          title: 'Student sees only their own grades',
          given: 'an authenticated student with recorded grades',
          when: 'they open the grades page',
          then: 'the response contains only that student\'s own grades',
        },
        {
          id: 'AC-011',
          title: 'Grade access is logged',
          given: 'an authenticated student opening their grades',
          when: 'the grade is read',
          then: 'an audit record is written with who, what and when',
        },
      ],
    },
  ],
  assumptions: [
    { id: 'ASM-010', text: 'A teacher can see the grades of their whole class', status: 'confirmed', resolution: 'pedagogical rule' },
  ],
  questions: [],
  constitution: true, // uses the LGPD/education preset
};

// Helper: clones a base feature so a defect can be seeded without mutating the original
function clone(base) {
  return JSON.parse(JSON.stringify(base));
}

// Builds the scenarios by applying a defect on top of a base feature.
export const SCENARIOS = [
  {
    id: 'S00-baseline',
    defectClass: 'CLEAN_BASELINE',
    feature: clone(enrollmentBase),
    seed: () => {}, // nothing — correct spec
  },
  {
    id: 'S01-req-no-test',
    defectClass: 'REQ_NO_TEST',
    feature: clone(enrollmentBase),
    seed: (f) => {
      // AC-002 will have no annotated test (the adapter only generates a test for AC-001)
      f.__noTest = ['AC-002'];
    },
  },
  {
    id: 'S02-orphan-test',
    defectClass: 'ORPHAN_TEST',
    feature: clone(enrollmentBase),
    seed: (f) => {
      // renames AC-002 → AC-050 in the spec, but the test still uses @spec:AC-002
      f.stories[0].acs[1].id = 'AC-050';
      f.__orphanTest = { specId: 'AC-050', testId: 'AC-002' };
    },
  },
  {
    id: 'S03-incomplete-req',
    defectClass: 'INCOMPLETE_REQ',
    feature: clone(enrollmentBase),
    seed: (f) => {
      // AC-002 loses its Then (no observable behavior)
      f.stories[0].acs[1].then = '';
      f.__incomplete = ['AC-002'];
    },
  },
  {
    id: 'S04-premature-done',
    defectClass: 'PREMATURE_DONE',
    feature: clone(enrollmentBase),
    seed: (f) => {
      // task marked done, but the AC's test fails (no PASS proof)
      f.__taskDoneWithFailure = ['AC-001'];
    },
  },
  {
    id: 'S05-silent-assumption',
    defectClass: 'SILENT_ASSUMPTION',
    feature: clone(enrollmentBase),
    seed: (f) => {
      // feature "implemented" but with an open (unresolved) assumption
      f.status = 'implemented';
      f.assumptions.push({
        id: 'ASM-002',
        text: 'The student cannot cancel their own enrollment',
        status: 'open',
        resolution: '—',
      });
    },
  },
  {
    id: 'S06-privacy-violated',
    defectClass: 'PRIVACY_VIOLATED',
    feature: clone(gradesBase),
    seed: (f) => {
      // leaks a grade into a log — violates P-004 of the LGPD constitution
      f.__leak = "console.log('student grade', grade);";
    },
  },
  {
    id: 'S07-orphan-code',
    defectClass: 'ORPHAN_CODE',
    feature: clone(enrollmentBase),
    seed: (f) => {
      // a code file that no task maps
      f.__orphanCode = 'src/secret-tracker.js';
    },
  },
  {
    id: 'S08-broken-ref',
    defectClass: 'BROKEN_REF',
    feature: clone(enrollmentBase),
    seed: (f) => {
      // task references a nonexistent AC-999
      f.__brokenRef = 'AC-999';
    },
  },
  {
    id: 'S09-duplicate-id',
    defectClass: 'DUPLICATE_ID',
    feature: clone(enrollmentBase),
    seed: (f) => {
      // duplicates the ID AC-001 across two criteria
      f.stories[0].acs[1].id = 'AC-001';
      f.__duplicateId = 'AC-001';
    },
  },
];

// Applies the seeds once.
for (const s of SCENARIOS) s.seed(s.feature);
