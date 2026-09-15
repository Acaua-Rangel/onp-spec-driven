// Implementation of the class-enrollment feature.
// Mapped by T-001, T-002, T-003 in .spec/features/class-enrollment/tasks.md.

export function enroll({ classroom, data }) {
  if (classroom.seats <= 0) {
    return { ok: false, reason: 'class full' };
  }
  if (data.age < 18 && !data.guardian) {
    return { ok: false, reason: "guardian's consent required" };
  }
  classroom.seats -= 1;
  return { ok: true, enrollment: { email: data.email, classroomId: classroom.id } };
}
