# Spec: Class enrollment

> feature: class-enrollment
> status: implemented

## Context

An interested visitor enrolls in an open class of the course. The system
respects the seat limit and, when the student is a minor, requires a
guardian's consent (LGPD art. 14).

## Stories

### US-001 — Student enrolls in an open class

As an interested visitor, I want to enroll in a class with open seats, so that
I secure my spot in the course.

#### AC-001 — Enrollment in a class with an open seat

- **Given** an open class with available seats
- **When** the visitor submits a valid name, email and phone
- **Then** the enrollment is recorded and the seat count is decremented

#### AC-002 — Full class refuses enrollment

- **Given** a class with no seats
- **When** the visitor tries to enroll
- **Then** the enrollment is refused with the message "class full"

### US-002 — Minor requires consent

As a guardian, I want to authorize a minor's enrollment, so that the
registration has a legal basis.

#### AC-003 — Minor's enrollment without consent is blocked

- **Given** a visitor who reports an age below 18
- **When** they try to complete enrollment without guardian data
- **Then** the enrollment is blocked, requesting the guardian's consent

## Out of scope

- Billing and payment (separate feature).
- Enrollment cancellation by the student.

## Assumptions

| ID | Assumption | Status | Resolution |
|---|---|---|---|
| ASM-001 | Email is the student's unique identifier | confirmed | decided with product on 07/17 |
| ASM-002 | Age is self-declared on the form | confirmed | MVP does not validate a document |

## Open questions

| ID | Question | Status | Answer |
|---|---|---|---|
| Q-001 | Do we store the guardian's email separately from the student's email? | answered | yes, its own field |

