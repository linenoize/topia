import { isWriteTool } from './contract.js';
const EMPTY = '';
export function measurementsComplete(report) {
    return (typeof report.practice === 'string' &&
        report.practice.length > 0 &&
        typeof report.experience === 'string' &&
        report.experience.length > 0 &&
        typeof report.security === 'string' &&
        report.security.length > 0 &&
        typeof report.pii === 'string' &&
        report.pii.length > 0 &&
        typeof report.vendorImpact === 'string' &&
        report.vendorImpact.length > 0);
}
export function assertPracticeReview(report) {
    if (report === null || !measurementsComplete(report)) {
        throw new Error('Practice review reports practice, experience, security, and PII before a recommendation.');
    }
    return report;
}
/** A review finding can stop a recommendation. It cannot add to the confirmed change. */
export function reviewAllowsRecommendation(report, proposed) {
    assertPracticeReview(report);
    if (report.stopRecommendation)
        return { ok: false, reason: 'Practice review stopped this recommendation.' };
    const extra = proposed.filter(item => !report.confirmedChange.includes(item));
    if (extra.length > 0)
        return { ok: false, reason: 'A review finding cannot widen the confirmed change.' };
    return { ok: true };
}
export function assertReviewTool(tool) {
    if (isWriteTool(tool))
        throw new Error('practice-review cannot call write tools.');
}
export const BLANK_MEASUREMENTS = {
    practice: EMPTY,
    experience: EMPTY,
    security: EMPTY,
    pii: EMPTY,
    vendorImpact: EMPTY,
};
