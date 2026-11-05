import {validate} from './logic.js';

const publicFields = ['category','description','lat','lng','occurredAt','status','source','createdAt'];
const fail = code => Object.assign(new Error(code), {code});
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  !['.','..'].includes(value) && !/[\/\u0000-\u001f\u007f]/.test(value);

export function eligibleModerator(user) {
  return Boolean(safeId(user?.uid) && user.isAnonymous === false && user.emailVerified === true);
}

export function moderatorIsActive(user, membership) {
  return eligibleModerator(user) && membership?.active === true;
}

export function prepareReportReview({reportId, report, nextStatus, moderatorUid, reviewedAt}) {
  if (!safeId(reportId) || !safeId(moderatorUid)) throw fail('moderation/invalid-request');
  if (!['approved','rejected'].includes(nextStatus)) throw fail('moderation/invalid-decision');
  if (report?.status !== 'pending') throw fail('moderation/already-reviewed');
  // Unsafe or malformed pending records must remain rejectable. Rejection
  // preserves the original private record and exposes only a status decision;
  // publication still needs the complete allowed public shape and validation.
  if (nextStatus === 'approved' && (!report || Object.keys(report).length !== publicFields.length ||
      Object.keys(report).some(key => !publicFields.includes(key)) || report.source !== 'community' ||
      !report.createdAt || validate(report))) {
    throw fail('moderation/invalid-report');
  }
  if (reviewedAt === undefined) throw fail('moderation/invalid-request');
  return {
    patch: {status: nextStatus},
    audit: {reportId, moderatorUid, status: nextStatus, reviewedAt},
  };
}

// Small adapter around the actual Firebase client transaction contract. Reads
// occur before writes, and the role is checked again inside every retry.
export function createReportReviewer({currentUser, reference, transaction, timestamp}) {
  if (![currentUser,reference,transaction,timestamp].every(value => typeof value === 'function')) throw fail('moderation/invalid-adapter');
  return async function reviewReport(reportId, nextStatus) {
    const user = currentUser();
    if (!eligibleModerator(user)) throw fail('moderation/not-authorized');
    if (!safeId(reportId)) throw fail('moderation/invalid-request');
    if (!['approved','rejected'].includes(nextStatus)) throw fail('moderation/invalid-decision');
    const uid = user.uid;
    const membershipRef = reference('reportModerators', uid);
    const reportRef = reference('reports', reportId);
    const auditRef = reference('reportReviews', reportId);
    await transaction(async tx => {
      const [membership, report, audit] = await Promise.all([tx.get(membershipRef), tx.get(reportRef), tx.get(auditRef)]);
      const activeUser = currentUser();
      if (activeUser?.uid !== uid) throw fail('moderation/session-changed');
      if (!moderatorIsActive(activeUser, membership.exists() ? membership.data() : null)) throw fail('moderation/not-authorized');
      if (!report.exists()) throw fail('moderation/report-not-found');
      if (audit.exists()) throw fail('moderation/already-reviewed');
      const update = prepareReportReview({reportId, report:report.data(), nextStatus, moderatorUid:uid, reviewedAt:timestamp()});
      tx.update(reportRef, update.patch);
      tx.set(auditRef, update.audit);
    });
    return {id:reportId, status:nextStatus};
  };
}

export function prepareReportWithdrawal({reportId, report, moderatorUid, withdrawnAt}) {
  if (!safeId(reportId) || !safeId(moderatorUid) || withdrawnAt === undefined) throw fail('moderation/invalid-request');
  if (report?.status === 'withdrawn') throw fail('moderation/already-withdrawn');
  if (report?.status !== 'approved') throw fail('moderation/not-published');
  // Retirement must also work for legacy records published from the Console.
  // No public content is changed and no report text enters the private audit.
  return {
    patch: {status: 'withdrawn'},
    audit: {reportId, moderatorUid, status: 'withdrawn', withdrawnAt},
  };
}

export function createReportWithdrawer({currentUser, reference, transaction, timestamp}) {
  if (![currentUser,reference,transaction,timestamp].every(value => typeof value === 'function')) throw fail('moderation/invalid-adapter');
  return async function withdrawReport(reportId) {
    const user = currentUser();
    if (!eligibleModerator(user)) throw fail('moderation/not-authorized');
    if (!safeId(reportId)) throw fail('moderation/invalid-request');
    const uid = user.uid;
    const membershipRef = reference('reportModerators', uid);
    const reportRef = reference('reports', reportId);
    const withdrawalRef = reference('reportWithdrawals', reportId);
    await transaction(async tx => {
      const [membership, report, withdrawal] = await Promise.all([
        tx.get(membershipRef), tx.get(reportRef), tx.get(withdrawalRef),
      ]);
      const activeUser = currentUser();
      if (activeUser?.uid !== uid) throw fail('moderation/session-changed');
      if (!moderatorIsActive(activeUser, membership.exists() ? membership.data() : null)) throw fail('moderation/not-authorized');
      if (!report.exists()) throw fail('moderation/report-not-found');
      if (withdrawal.exists()) throw fail('moderation/already-withdrawn');
      const update = prepareReportWithdrawal({reportId, report:report.data(), moderatorUid:uid, withdrawnAt:timestamp()});
      tx.update(reportRef, update.patch);
      tx.set(withdrawalRef, update.audit);
    });
    return {id:reportId, status:'withdrawn'};
  };
}
