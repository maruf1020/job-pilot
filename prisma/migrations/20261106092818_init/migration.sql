-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "onboardedAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "searchIntervalMinutes" INTEGER NOT NULL DEFAULT 720,
    "searchEnabled" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "digestEnabled" BOOLEAN NOT NULL DEFAULT true,
    "digestHourLocal" INTEGER NOT NULL DEFAULT 9,
    "digestEmail" TEXT,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushTypes" TEXT[] DEFAULT ARRAY['interview', 'reply', 'review_needed', 'error']::TEXT[],
    "search" JSONB NOT NULL,
    "ranking" JSONB NOT NULL,
    "email" JSONB NOT NULL,
    "ai" JSONB NOT NULL,
    "portal" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "fullName" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "phone" TEXT,
    "location" TEXT NOT NULL DEFAULT '',
    "yearsExperience" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL DEFAULT '',
    "givenName" TEXT,
    "familyName" TEXT,
    "preferredName" TEXT,
    "pronouns" TEXT,
    "gender" TEXT,
    "dateOfBirth" TEXT,
    "phoneCountryCode" TEXT,
    "addressLine" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "timezone" TEXT,
    "citizenships" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "links" JSONB,
    "profession" TEXT NOT NULL DEFAULT 'software',
    "field" TEXT,
    "seniority" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "workAuth" JSONB,
    "relocation" TEXT,
    "remote" TEXT,
    "languageLevels" JSONB,
    "degree" TEXT,
    "gpa" TEXT,
    "diversity" JSONB,
    "emailVoice" JSONB,
    "salaryCurrency" TEXT,
    "salaryOnlyWhenAsked" BOOLEAN NOT NULL DEFAULT true,
    "howHeard" TEXT,
    "motivation" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "titles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "facts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stopSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "experience" JSONB,
    "education" JSONB,
    "signature" TEXT,
    "mindset" TEXT,
    "noticePeriod" TEXT,
    "salaryExpectation" TEXT,
    "earliestStart" TEXT,
    "resumeText" TEXT,
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeFile" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "domain" TEXT,
    "countryCode" TEXT,
    "atsType" TEXT,
    "atsSlug" TEXT,
    "careersUrl" TEXT,
    "contactEmail" TEXT,
    "contactEmailSource" TEXT,
    "contactCandidates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactCheckedAt" TIMESTAMP(3),
    "contactNotes" TEXT,
    "knownSponsor" BOOLEAN NOT NULL DEFAULT false,
    "blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "lastFetchError" TEXT,
    "boardSource" TEXT,
    "boardCheckedAt" TIMESTAMP(3),
    "boardMatchingJobs" INTEGER,
    "boardMatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactDiscoveryRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "batchSize" INTEGER NOT NULL DEFAULT 10,
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "found" INTEGER NOT NULL DEFAULT 0,
    "verified" INTEGER NOT NULL DEFAULT 0,
    "guessed" INTEGER NOT NULL DEFAULT 0,
    "jobsUpdated" INTEGER NOT NULL DEFAULT 0,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactDiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardDiscoveryRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "limit" INTEGER NOT NULL DEFAULT 150,
    "includeChecked" BOOLEAN NOT NULL DEFAULT false,
    "total" INTEGER NOT NULL DEFAULT 0,
    "checked" INTEGER NOT NULL DEFAULT 0,
    "boardsFound" INTEGER NOT NULL DEFAULT 0,
    "boardsRelevant" INTEGER NOT NULL DEFAULT 0,
    "relevantJobs" INTEGER NOT NULL DEFAULT 0,
    "dead" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "perAtsCounts" JSONB NOT NULL DEFAULT '{}',
    "noBoard" INTEGER NOT NULL DEFAULT 0,
    "perMethod" JSONB NOT NULL DEFAULT '{}',
    "phase" TEXT,
    "resumes" INTEGER NOT NULL DEFAULT 0,
    "currentCompany" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "lastTickAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardDiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardDiscoveryLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "companyName" TEXT,
    "atsType" TEXT,
    "atsSlug" TEXT,
    "relevantJobs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardDiscoveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiQuota" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiQuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorRegister" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "route" TEXT,
    "permits" INTEGER,
    "city" TEXT,
    "source" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SponsorRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerStatus" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL,
    "nextWakeAt" TIMESTAMP(3),
    "hostname" TEXT,
    "version" TEXT,
    "browser" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "employerLinkCheckedAt" TIMESTAMP(3),
    "location" TEXT,
    "countryCode" TEXT,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "currency" TEXT,
    "postedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "primarySource" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visaFlag" BOOLEAN,
    "sponsorship" TEXT NOT NULL DEFAULT 'unknown',
    "sponsorshipEvidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "applyChannel" TEXT NOT NULL DEFAULT 'unknown',
    "atsType" TEXT,
    "contactEmail" TEXT,
    "contactEmailSource" TEXT,
    "contactCandidates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactCheckedAt" TIMESTAMP(3),
    "language" TEXT,
    "seniority" TEXT,
    "mustHaveSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "niceToHaveSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relocationSupport" BOOLEAN,
    "summary" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "filterReason" TEXT,
    "finalScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSourceLink" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "raw" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobSourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobScore" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "ruleScore" INTEGER NOT NULL,
    "llmScore" INTEGER,
    "finalScore" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gaps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hook" TEXT,
    "model" TEXT,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "totalFetched" INTEGER NOT NULL DEFAULT 0,
    "totalNew" INTEGER NOT NULL DEFAULT 0,
    "totalDuplicates" INTEGER NOT NULL DEFAULT 0,
    "totalFiltered" INTEGER NOT NULL DEFAULT 0,
    "totalEnriched" INTEGER NOT NULL DEFAULT 0,
    "totalRanked" INTEGER NOT NULL DEFAULT 0,
    "totalDrafted" INTEGER NOT NULL DEFAULT 0,
    "totalQueued" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceCursor" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "query" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "nextPage" INTEGER NOT NULL DEFAULT 1,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "exhaustedAt" TIMESTAMP(3),
    "lastCreated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRunSource" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "query" TEXT,
    "country" TEXT,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "returned" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchRunSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRunLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "batchId" TEXT,
    "cooldownOverride" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "toEmail" TEXT,
    "threadId" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "followUpDueAt" TIMESTAMP(3),
    "followUpSentAt" TIMESTAMP(3),
    "followUpApprovedAt" TIMESTAMP(3),
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autoRetry" BOOLEAN NOT NULL DEFAULT false,
    "bounceCount" INTEGER NOT NULL DEFAULT 0,
    "coverLetter" TEXT,
    "answers" JSONB,
    "notes" TEXT,
    "portalStatus" TEXT,
    "portalStatusUrl" TEXT,
    "portalCheckedAt" TIMESTAMP(3),
    "submittedVia" TEXT,
    "experiment" JSONB,
    "cvVariant" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDraft" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'initial',
    "version" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "lintResult" JSONB,
    "judgeResult" JSONB,
    "externalAiScore" DOUBLE PRECISION,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "generatedBy" TEXT,
    "promptVersion" TEXT,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "threadId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "ccAddress" TEXT,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "classification" TEXT,
    "classificationMeta" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiKey" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "baseUrl" TEXT,
    "projectNumber" TEXT,
    "encryptedKey" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "keyHash" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primaryModel" TEXT,
    "liteModel" TEXT,
    "capabilities" JSONB,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "dailyCallCap" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rpmLimit" INTEGER NOT NULL DEFAULT 10,
    "rpdLimit" INTEGER NOT NULL DEFAULT 250,
    "usedToday" INTEGER NOT NULL DEFAULT 0,
    "usedTodayDate" TEXT,
    "cooldownUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "lastTestedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceKey" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "encryptedValues" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "lastTestedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteLesson" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "host" TEXT,
    "type" TEXT NOT NULL DEFAULT 'lesson',
    "outcome" TEXT,
    "lesson" TEXT NOT NULL,
    "category" TEXT,
    "pattern" TEXT,
    "blocker" TEXT,
    "fingerprint" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "keyId" TEXT,
    "provider" TEXT,
    "model" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressedAddress" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'bounce',
    "applicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressedAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannedPhrase" (
    "id" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "category" TEXT,
    "isRegex" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BannedPhrase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "classification" TEXT,
    "nextStep" BOOLEAN NOT NULL DEFAULT false,
    "ackedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeTarget" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "linkSelector" TEXT,
    "linkPattern" TEXT,
    "maxLinks" INTEGER NOT NULL DEFAULT 30,
    "maxPages" INTEGER NOT NULL DEFAULT 1,
    "requireEmail" BOOLEAN NOT NULL DEFAULT true,
    "countryCode" TEXT,
    "waitMs" INTEGER NOT NULL DEFAULT 1500,
    "notes" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastFound" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScrapeTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthToken" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountEmail" TEXT,
    "encryptedRefreshToken" TEXT NOT NULL,
    "encryptedAccessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastHistoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplyBatch" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "minScore" INTEGER NOT NULL,
    "includeGuessed" BOOLEAN NOT NULL DEFAULT false,
    "continuous" BOOLEAN NOT NULL DEFAULT false,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "considered" INTEGER NOT NULL DEFAULT 0,
    "drafted" INTEGER NOT NULL DEFAULT 0,
    "queued" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "held" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "waitingFor" TEXT,
    "note" TEXT,
    "lastTickAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplyBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAttempt" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "batchId" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "atsType" TEXT,
    "startUrl" TEXT,
    "formUrl" TEXT,
    "finalUrl" TEXT,
    "tabId" TEXT,
    "steps" JSONB,
    "fields" JSONB,
    "questions" JSONB,
    "screenshots" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "needsHumanReason" TEXT,
    "error" TEXT,
    "diagnosis" JSONB,
    "aiCalls" INTEGER NOT NULL DEFAULT 0,
    "host" TEXT,
    "lane" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostProfile" (
    "host" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'unknown',
    "atsType" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "submitted" INTEGER NOT NULL DEFAULT 0,
    "needsHuman" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "failStreak" INTEGER NOT NULL DEFAULT 0,
    "lastOutcome" TEXT,
    "lastReason" TEXT,
    "skipUntil" TIMESTAMP(3),
    "loggedIn" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostProfile_pkey" PRIMARY KEY ("host")
);

-- CreateTable
CREATE TABLE "PortalBatch" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "continuous" BOOLEAN NOT NULL DEFAULT false,
    "minScore" INTEGER NOT NULL,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "atsTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "considered" INTEGER NOT NULL DEFAULT 0,
    "submitted" INTEGER NOT NULL DEFAULT 0,
    "awaitingReview" INTEGER NOT NULL DEFAULT 0,
    "needsHuman" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "waitingFor" TEXT,
    "note" TEXT,
    "lastTickAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerBank" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'user',
    "timesSeen" INTEGER NOT NULL DEFAULT 1,
    "lastCompany" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnswerBank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAccount" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "statusUrl" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "kind" TEXT NOT NULL,
    "applicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Company_normalizedName_key" ON "Company"("normalizedName");

-- CreateIndex
CREATE INDEX "Company_atsType_atsSlug_idx" ON "Company"("atsType", "atsSlug");

-- CreateIndex
CREATE INDEX "Company_knownSponsor_idx" ON "Company"("knownSponsor");

-- CreateIndex
CREATE INDEX "Company_contactCheckedAt_idx" ON "Company"("contactCheckedAt");

-- CreateIndex
CREATE INDEX "Company_boardMatchingJobs_idx" ON "Company"("boardMatchingJobs");

-- CreateIndex
CREATE INDEX "ContactDiscoveryRun_status_startedAt_idx" ON "ContactDiscoveryRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "BoardDiscoveryRun_status_startedAt_idx" ON "BoardDiscoveryRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "BoardDiscoveryLog_runId_createdAt_idx" ON "BoardDiscoveryLog"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "BoardDiscoveryLog_createdAt_idx" ON "BoardDiscoveryLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiQuota_provider_day_key" ON "ApiQuota"("provider", "day");

-- CreateIndex
CREATE INDEX "SponsorRegister_normalizedName_idx" ON "SponsorRegister"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "SponsorRegister_country_normalizedName_key" ON "SponsorRegister"("country", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_finalScore_idx" ON "Job"("finalScore");

-- CreateIndex
CREATE INDEX "Job_countryCode_idx" ON "Job"("countryCode");

-- CreateIndex
CREATE INDEX "Job_sponsorship_idx" ON "Job"("sponsorship");

-- CreateIndex
CREATE INDEX "Job_firstSeenAt_idx" ON "Job"("firstSeenAt");

-- CreateIndex
CREATE INDEX "Job_postedAt_idx" ON "Job"("postedAt");

-- CreateIndex
CREATE INDEX "Job_companyName_idx" ON "Job"("companyName");

-- CreateIndex
CREATE INDEX "Job_title_idx" ON "Job"("title");

-- CreateIndex
CREATE INDEX "JobSourceLink_jobId_idx" ON "JobSourceLink"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobSourceLink_source_externalId_key" ON "JobSourceLink"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "JobScore_jobId_key" ON "JobScore"("jobId");

-- CreateIndex
CREATE INDEX "JobScore_finalScore_idx" ON "JobScore"("finalScore");

-- CreateIndex
CREATE INDEX "SearchRun_startedAt_idx" ON "SearchRun"("startedAt");

-- CreateIndex
CREATE INDEX "SearchRun_status_idx" ON "SearchRun"("status");

-- CreateIndex
CREATE INDEX "SourceCursor_source_lastRunAt_idx" ON "SourceCursor"("source", "lastRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceCursor_source_query_country_key" ON "SourceCursor"("source", "query", "country");

-- CreateIndex
CREATE INDEX "SearchRunSource_runId_idx" ON "SearchRunSource"("runId");

-- CreateIndex
CREATE INDEX "SearchRunLog_runId_createdAt_idx" ON "SearchRunLog"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Application_jobId_key" ON "Application"("jobId");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- CreateIndex
CREATE INDEX "Application_sentAt_idx" ON "Application"("sentAt");

-- CreateIndex
CREATE INDEX "Application_scheduledFor_idx" ON "Application"("scheduledFor");

-- CreateIndex
CREATE INDEX "EmailDraft_applicationId_idx" ON "EmailDraft"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDraft_applicationId_kind_version_key" ON "EmailDraft"("applicationId", "kind", "version");

-- CreateIndex
CREATE INDEX "EmailMessage_applicationId_idx" ON "EmailMessage"("applicationId");

-- CreateIndex
CREATE INDEX "EmailMessage_direction_isRead_idx" ON "EmailMessage"("direction", "isRead");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_provider_providerMessageId_key" ON "EmailMessage"("provider", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "AiKey_keyHash_key" ON "AiKey"("keyHash");

-- CreateIndex
CREATE INDEX "AiKey_enabled_priority_idx" ON "AiKey"("enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceKey_service_key" ON "ServiceKey"("service");

-- CreateIndex
CREATE UNIQUE INDEX "SiteLesson_fingerprint_key" ON "SiteLesson"("fingerprint");

-- CreateIndex
CREATE INDEX "SiteLesson_kind_type_idx" ON "SiteLesson"("kind", "type");

-- CreateIndex
CREATE INDEX "SiteLesson_host_type_idx" ON "SiteLesson"("host", "type");

-- CreateIndex
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_keyId_createdAt_idx" ON "AiUsage"("keyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressedAddress_email_key" ON "SuppressedAddress"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BannedPhrase_phrase_key" ON "BannedPhrase"("phrase");

-- CreateIndex
CREATE INDEX "Notification_readAt_createdAt_idx" ON "Notification"("readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_nextStep_ackedAt_idx" ON "Notification"("nextStep", "ackedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthToken_provider_key" ON "OAuthToken"("provider");

-- CreateIndex
CREATE INDEX "ApplyBatch_status_idx" ON "ApplyBatch"("status");

-- CreateIndex
CREATE INDEX "PortalAttempt_applicationId_startedAt_idx" ON "PortalAttempt"("applicationId", "startedAt");

-- CreateIndex
CREATE INDEX "PortalAttempt_status_idx" ON "PortalAttempt"("status");

-- CreateIndex
CREATE INDEX "PortalAttempt_batchId_idx" ON "PortalAttempt"("batchId");

-- CreateIndex
CREATE INDEX "PortalAttempt_host_idx" ON "PortalAttempt"("host");

-- CreateIndex
CREATE INDEX "HostProfile_kind_idx" ON "HostProfile"("kind");

-- CreateIndex
CREATE INDEX "HostProfile_skipUntil_idx" ON "HostProfile"("skipUntil");

-- CreateIndex
CREATE INDEX "PortalBatch_status_idx" ON "PortalBatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerBank_key_key" ON "AnswerBank"("key");

-- CreateIndex
CREATE INDEX "AnswerBank_answer_idx" ON "AnswerBank"("answer");

-- CreateIndex
CREATE UNIQUE INDEX "PortalAccount_host_key" ON "PortalAccount"("host");

-- CreateIndex
CREATE INDEX "ApplicationEvent_applicationId_createdAt_idx" ON "ApplicationEvent"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "InboxMessage_applicationId_idx" ON "InboxMessage"("applicationId");

-- CreateIndex
CREATE INDEX "InboxMessage_createdAt_idx" ON "InboxMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "BoardDiscoveryLog" ADD CONSTRAINT "BoardDiscoveryLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BoardDiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSourceLink" ADD CONSTRAINT "JobSourceLink_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobScore" ADD CONSTRAINT "JobScore_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRunSource" ADD CONSTRAINT "SearchRunSource_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRunLog" ADD CONSTRAINT "SearchRunLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ApplyBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "AiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAttempt" ADD CONSTRAINT "PortalAttempt_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAttempt" ADD CONSTRAINT "PortalAttempt_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PortalBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
