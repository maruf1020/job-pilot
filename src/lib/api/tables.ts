import { APPLICATION_STATUSES, APPLY_CHANNELS, ATS_TYPES, JOB_STATUSES, REPLY_CLASSIFICATIONS, RUN_STATUSES, RUN_TRIGGERS, SENIORITIES, SOURCE_IDS, SPONSORSHIP_LEVELS } from '@/lib/domain'
import type { TableQueryConfig } from '@/lib/table-query'

export const JOBS_TABLE: TableQueryConfig = {
  sortable: ['score', 'title', 'companyName', 'countryCode', 'postedAt', 'firstSeenAt', 'status', 'sponsorship'],
  searchable: ['title', 'companyName', 'location'],
  filterable: {
    status: { type: 'enum', values: JOB_STATUSES, description: 'Pipeline status' },
    country: { type: 'string', path: 'countryCode', description: 'ISO country code' },
    sponsorship: { type: 'enum', values: SPONSORSHIP_LEVELS },
    source: { type: 'enum', values: SOURCE_IDS, path: 'primarySource' },
    channel: { type: 'enum', values: APPLY_CHANNELS, path: 'applyChannel' },
    score: { type: 'number', path: 'finalScore', description: 'Final score 0-100' },
    remote: { type: 'boolean' },
    seniority: { type: 'enum', values: SENIORITIES },
    seenSince: { type: 'date', path: 'firstSeenAt' },
    postedSince: { type: 'date', path: 'postedAt' },
    companyId: { type: 'string' },
  },
  defaultSort: { field: 'score', dir: 'desc' },
  sortMapping: { score: 'finalScore' },
  sortNullsLast: ['score', 'postedAt'],
}

export const APPLICATIONS_TABLE: TableQueryConfig = {
  sortable: ['lastActivityAt', 'sentAt', 'status', 'scheduledFor', 'createdAt', 'score', 'companyName'],
  searchable: ['job.title', 'job.companyName'],
  filterable: {
    status: { type: 'enum', values: APPLICATION_STATUSES },
    channel: { type: 'enum', values: APPLY_CHANNELS },
    country: { type: 'string', path: 'job.countryCode' },
    sentSince: { type: 'date', path: 'sentAt' },
    // Board filters
    company: { type: 'string', path: 'job.companyName' },
    score: { type: 'number', path: 'job.finalScore' },
    sponsorship: { type: 'enum', values: SPONSORSHIP_LEVELS, path: 'job.sponsorship' },
    sent: { type: 'date', path: 'sentAt' },
    activity: { type: 'date', path: 'lastActivityAt' },
    scheduled: { type: 'date', path: 'scheduledFor' },
    replied: { type: 'date', path: 'repliedAt' },
    followUp: { type: 'date', path: 'followUpSentAt' },
    toEmail: { type: 'string' },
  },
  defaultSort: { field: 'lastActivityAt', dir: 'desc' },
  sortMapping: { score: 'job.finalScore', companyName: 'job.companyName' },
  sortNullsLast: ['sentAt', 'scheduledFor'],
}

export const RUNS_TABLE: TableQueryConfig = {
  sortable: ['startedAt', 'status', 'totalNew', 'totalFetched', 'durationMs'],
  searchable: [],
  filterable: {
    status: { type: 'enum', values: RUN_STATUSES },
    trigger: { type: 'enum', values: RUN_TRIGGERS },
    since: { type: 'date', path: 'startedAt' },
  },
  defaultSort: { field: 'startedAt', dir: 'desc' },
}

export const COMPANIES_TABLE: TableQueryConfig = {
  sortable: ['name', 'countryCode', 'knownSponsor', 'blacklisted', 'lastFetchedAt', 'createdAt', 'boardMatchingJobs'],
  searchable: ['name', 'domain'],
  filterable: {
    knownSponsor: { type: 'boolean' },
    blacklisted: { type: 'boolean' },
    atsType: { type: 'enum', values: ATS_TYPES },
    hasAts: { type: 'boolean' },
    hasMatching: { type: 'boolean' },
    country: { type: 'string', path: 'countryCode' },
  },
  defaultSort: { field: 'name', dir: 'asc' },
  sortNullsLast: ['lastFetchedAt', 'boardMatchingJobs'],
}

export const INBOX_TABLE: TableQueryConfig = {
  sortable: ['receivedAt', 'classification', 'fromAddress'],
  searchable: ['subject', 'fromAddress', 'bodyText'],
  filterable: {
    classification: { type: 'enum', values: REPLY_CLASSIFICATIONS },
    isRead: { type: 'boolean' },
    since: { type: 'date', path: 'receivedAt' },
  },
  defaultSort: { field: 'receivedAt', dir: 'desc' },
}
