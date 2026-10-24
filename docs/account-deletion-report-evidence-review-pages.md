# Shadow Live — account erasure legal report/evidence review pages (internal / OFF)

Existing `report-evidence-retention.js` owns the **90-day after final
report decision** cleanup lifecycle, with safeguards for appeals,
legal holds and diary report mirrors. A deletion request does **not**
accelerate this retention period, and a due timestamp is never
sufficient to certify erasure.

`inspectAccountReportEvidencePage(db,{uid,requestId,actor,scope,cursor,limit,nowMs})`
performs ONE indexed `reports` query for `reporterUid`, `targetUid`,
legacy `reporterId`, or legacy `targetUserId`, with at most **five
rows** plus one lookahead. Use an explicit cursor to request another
page. The caller must separately authenticate an Owner; this module is
NOT exposed through any route. It validates current request/checkpoint
IDs, non-Owner user, current review/processing state, and blocks legal,
report, investigation and retention holds on those records.

The module checks only up to five exact `diary_reports/{reportId}`
mirrors, when a report targets a diary or diary comment. It signals
evidence presence, active appeal/investigation/legal holds (including
the mirror), whether the report has a final status, and whether
`evidencePurgeAt` is present or elapsed. Missing/malformed deadlines,
pending, reopened or legacy reports remain under manual review.
A timestamp **before now** does not prove that evidence was lawfully
purged; the existing independent retention engine must do that.

No report reasons, evidence, screenshot references, reporter identity,
target identity, room or conversation data, financial records, or
legal text are included. Pagination cursors may contain document
identifiers and must never be sent raw to future public clients;
bind/encrypt them or keep them in a server-side checkpoint.

**No Firestore writes, R2 listing/get/deletion, Auth removal, background
scan, legal approval or completion certificate** occurs. Even an
empty result always says `exhaustive:false`,
`retentionCertified:false`, `evidenceErased:false`,
`erasureAllowed:false`, `completionVerified:false`.
Actual clearance also requires investigation into `diary_reports`,
`content_filter_flags`, room evidence, legacy unindexed records,
pending objections, and storage evidence retained under appropriate
legal basis and access controls.

Unit and disposable Firestore Emulator tests cover 5/5/2 and 2/2/2
paged report reads, reporter/target and legacy scopes, invalid
request/holds, active appeals, diary mirror preservation, private
content suppression, and leaving counterpart reports untouched.
