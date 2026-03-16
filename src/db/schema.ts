import { defineConfig } from "drizzle-kit";
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { type InferSelectModel, type InferInsertModel } from 'drizzle-orm';

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});




// ==========================================
// OBSERVABILITY & SYSTEM HEALTH
// ==========================================

/**
 * **Application Logs**
 * * Centralized logging table for debugging, auditing, and activity tracking.
 * * @ai_usage Used by observability agents to diagnose errors. Query by `traceId` to correlate with `traces` table.
 * @field timestamp - ISO 8601 string.
 * @field metadata - JSON string containing contextual key-value pairs.
 * @field traceId - Correlation ID to link logs with specific request traces.
 */
export const logs = sqliteTable('logs', {
  id: integer('id').primaryKey(),
  timestamp: text('timestamp').notNull(),
  level: text('level').notNull(), // 'INFO', 'WARN', 'ERROR', 'DEBUG'
  component: text('component').notNull(),
  message: text('message').notNull(),
  traceId: text('traceId'),
  userId: text('userId'),
  sessionId: text('sessionId'),
  requestId: text('requestId'),
  error: text('error'), // Stack traces or error names
  metadata: text('metadata'), // JSON serialized
  createdAt: text('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * **Distributed Traces**
 * * Represents the lifecycle of a single operation or request flow.
 * * @ai_usage Use this to analyze system performance and bottlenecks. 
 * Calculate `duration` (end_time - start_time) if null.
 */
export const traces = sqliteTable('traces', {
  id: text('id').primaryKey(),
  traceId: text('traceId').notNull(),
  parentId: text('parentId'), // For nested spans
  name: text('name').notNull(), // Operation name
  component: text('component').notNull(),
  status: text('status').notNull(), // 'success', 'error', 'pending'
  startTime: text('startTime').notNull(),
  endTime: text('endTime'),
  duration: integer('duration'), // In milliseconds
  metadata: text('metadata'), // JSON serialized
  createdAt: text('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * **Trace Events**
 * * Granular events or checkpoints that occur *within* a specific trace.
 * * @ai_usage Useful for deep-dive debugging to see the sequence of actions within a single trace.
 * @field data - JSON string containing payload or state at the time of the event.
 */
export const traceEvents = sqliteTable('traceEvents', {
  id: integer('id').primaryKey(),
  traceId: text('traceId').notNull(),
  eventId: text('eventId').notNull(),
  timestamp: text('timestamp').notNull(),
  level: text('level').notNull(),
  component: text('component').notNull(),
  action: text('action').notNull(),
  message: text('message').notNull(),
  data: text('data'), // JSON serialized
  codeLocation: text('codeLocation'), // e.g., 'src/services/auth.ts:45'
  createdAt: text('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * **System Health Tests**
 * * Registry of automated self-tests run on-device (via cron).
 * * @ai_usage Query to verify system integrity and AI performance over time.
 */
export const systemHealthTests = sqliteTable('system_health_tests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(), // UUID for the batch
  testName: text('test_name').notNull(),
  triggerSource: text('trigger_source').notNull().default('SCHEDULED'), // 'SCHEDULED', 'ON_DEMAND'
  status: text('status').notNull(), // 'PASS', 'FAIL', 'WARN', 'IN_PROGRESS'
  durationMs: integer('duration_ms'),
  metadata: text('metadata'), // Input context (JSON)
  resultJson: text('result_json'), // Full verbose output (JSON)
  error: text('error'),
  executedAt: text('executed_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});


// ==========================================
// USER DOMAIN & ANALYTICS
// ==========================================

/**
 * **Market Snapshots**
 * * Aggregated or point-in-time market data used for quick frontend retrieval 
 * or trend analysis. 
 * * @ai_usage Source this table for "at a glance" market summaries rather than querying raw HDB tables.
 * @field yieldRate - Calculated rental yield percentage.
 */
export const marketSnapshots = sqliteTable('marketSnapshots', {
  id: integer('id').primaryKey(),
  town: text('town').notNull(),
  flatType: text('flatType').notNull(),
  price: real('price').notNull(),
  yieldRate: real('yieldRate'),
  createdAt: text('createdAt').notNull(),
});

/**
 * **Tracked Properties**
 * * Specific HDB units that a user is actively monitoring.
 * * @field block - HDB Block number.
 * * @field street - Street name.
 * * @field floorAreaSqm - Size in Square Meters.
 */
export const trackedProperties = sqliteTable('trackedProperties', {
  id: integer('id').primaryKey(),
  userId: text('userId').notNull(),
  block: text('block').notNull(),
  street: text('street').notNull(),
  floorAreaSqm: real('floorAreaSqm').notNull(),
  flatType: text('flatType').notNull(),
  leaseCommenceDate: integer('leaseCommenceDate').notNull(), // Year
  acquisitionDate: text('acquisitionDate').notNull(), // ISO Date
  notes: text('notes'),
  createdAt: text('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  datasetId: text('datasetId'),
  ingestedAt: text('ingestedAt'),
});

/**
 * **Buyer Preferences**
 * * User-defined criteria for property alerts and matching algorithms.
 * * @ai_context IMPORTANT: `targetTowns`, `flatTypes`, `amenities`, and `employmentCenters` 
 * are stored as JSON strings. You must parse them before processing.
 */
export const buyerPreferences = sqliteTable('buyerPreferences', {
  id: integer('id').primaryKey(),
  userId: text('userId').notNull(),
  targetTowns: text('targetTowns'), // JSON Array<string>
  flatTypes: text('flatTypes'), // JSON Array<string>
  priceRangeMin: real('priceRangeMin'),
  priceRangeMax: real('priceRangeMax'),
  amenities: text('amenities'), // JSON Array<string>
  employmentCenters: text('employmentCenters'), // JSON Array<string>
  createdAt: text('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`),
});


// ==========================================
// RAW INGESTION TABLES (HDB SINGAPORE DATA)
// ==========================================

/**
 * **Raw HDB Resale Prices**
 * * Historical transaction records for Singapore HDB resale flats.
 * This is the source of truth for valuation models.
 * * @field resalePrice - Transaction price in SGD.
 * * @field remainingLease - Raw string format (e.g., "90 years 05 months").
 * * @field remainingLeaseYears - Parsed integer year component.
 */
export const rawHdbResalePrices = sqliteTable('rawHdbResalePrices', {
  id: integer('id').primaryKey(),
  month: text('month'), // YYYY-MM
  year: integer('year'),
  town: text('town'),
  flatType: text('flatType'),
  block: text('block'),
  streetName: text('streetName'),
  storeyRange: text('storeyRange'),
  floorAreaSqm: real('floorAreaSqm'),
  flatModel: text('flatModel'),
  leaseCommenceDate: integer('leaseCommenceDate'),
  remainingLease: text('remainingLease'),
  resalePrice: real('resalePrice'),
  monthRaw: text('monthRaw'),
  remainingLeaseYears: integer('remainingLeaseYears'),
  remainingLeaseMonths: integer('remainingLeaseMonths'),
  leaseExpirationDate: text('leaseExpirationDate'),

  // Geocoding enrichment columns
  latitude: real('latitude'),
  longitude: real('longitude'),
  postalCode: text('postalCode'),
  isGeocoded: integer('isGeocoded', { mode: 'boolean' }).default(false),
});

/**
 * **Raw HDB Demand**
 * * Aggregated demand statistics for various flat types over periods.
 * Used for gauging market sentiment and over/undersupply.
 */
export const rawHdbDemand = sqliteTable('rawHdbDemand', {
  id: integer('id').primaryKey(),
  startYear: integer('startYear'),
  endYear: integer('endYear'),
  flatType: text('flatType'),
  demandForFlats: integer('demandForFlats'), // Number of applications/interests
});

/**
 * **Raw HDB Median Rent**
 * * Quarterly median rental prices by town and flat type.
 * * @field medianRent - Price in SGD. If null, insufficient data for that quarter.
 */
export const rawHdbMedianRent = sqliteTable('rawHdbMedianRent', {
  id: integer('id').primaryKey(),
  town: text('town'),
  flatType: text('flatType'),
  flatTypeRaw: text('flatTypeRaw'),
  medianRent: real('medianRent'),
  medianRentRaw: text('medianRentRaw'),
  quarter: integer('quarter'),
  quarterRaw: text('quarterRaw'), // e.g. "2023-Q1"
  year: integer('year'),
  startMonth: integer('startMonth'),
  endMonth: integer('endMonth'),
});

/**
 * **Raw HDB Property Information**
 * * Static metadata about specific HDB blocks.
 * Contains composition data (how many 3-room vs 4-room flats exist in a block).
 * * @ai_usage Use this to determine the "rarity" of a specific flat type within a block or neighborhood.
 * * @field commercial - 'Y' or 'N' indicating commercial units present.
 */
export const rawHdbPropertyInfo = sqliteTable('rawHdbPropertyInfo', {
  id: integer('id').primaryKey(),
  blkNo: text('blkNo'),
  street: text('street'),
  maxFloorLvl: integer('maxFloorLvl'),
  yearCompleted: integer('yearCompleted'),
  bldgContractTown: text('bldgContractTown'),
  residential: text('residential'),
  commercial: text('commercial'),
  marketHawker: text('marketHawker'),
  miscellaneous: text('miscellaneous'),
  multistoreyCarpark: text('multistoreyCarpark'),
  precinctPavilion: text('precinctPavilion'),
  oneRoomSold: integer('oneRoomSold'), // Count of units
  twoRoomSold: integer('twoRoomSold'),
  threeRoomSold: integer('threeRoomSold'),
  fourRoomSold: integer('fourRoomSold'),
  fiveRoomSold: integer('fiveRoomSold'),
  execSold: integer('execSold'),
  multigenSold: integer('multigenSold'),
  studioApartmentSold: integer('studioApartmentSold'),
  oneRoomRental: integer('oneRoomRental'), // Count of rental units
  twoRoomRental: integer('twoRoomRental'),
  threeRoomRental: integer('threeRoomRental'),
  otherRoomRental: integer('otherRoomRental'),
});

/**
 * **Raw HDB Rental Prices**
 * * Specific rental transaction approvals.
 * Note: HDB does not provide exact unit numbers for privacy, only block/street.
 * * @field monthlyRent - Price in SGD.
 */
export const rawHdbRentalPrices = sqliteTable('rawHdbRentalPrices', {
  id: integer('id').primaryKey(),
  rentApprovalDate: text('rentApprovalDate'), // YYYY-MM
  town: text('town'),
  block: text('block'),
  streetName: text('streetName'),
  flatType: text('flatType'),
  monthlyRent: real('monthlyRent'),

  // Geocoding enrichment columns
  latitude: real('latitude'),
  longitude: real('longitude'),
  postalCode: text('postalCode'),
  isGeocoded: integer('isGeocoded', { mode: 'boolean' }).default(false),
  rentApprovalYear: integer('rentApprovalYear'),
  rentApprovalMonth: integer('rentApprovalMonth'),
});

/**
 * **Raw HDB Resale Index**
 * * Quarterly price index for resale flats by town and flat type.
 * * @field index - Price index value (base period = 100).
 */
export const rawHdbResaleIndex = sqliteTable('rawHdbResaleIndex', {
  id: integer('id').primaryKey(),
  town: text('town'),
  flatType: text('flatType'),
  index: real('index'),
  quarter: integer('quarter'),
  quarterRaw: text('quarterRaw'),
  year: integer('year'),
  datasetId: text('datasetId'),
  ingestedAt: text('ingestedAt'),
});


// ==========================================
// HAWKER CENTRES & MARKETS
// ==========================================

/**
 * **Government Markets & Hawker Centres**
 * * Master list of government-run markets and hawker centres with capacity data
 * * @ai_usage Use this for facility capacity analysis and market/hawker centre identification
 * * @field nameOfCentre - Official name of the facility
 * * @field locationOfCentre - Address of the facility
 * * @field typeOfCentre - Type code (MK=Market, HC=Hawker Centre, MHC=Market+Hawker)
 * * @field noOfStalls - Total number of stalls
 * * @field isMarket - Derived flag indicating if facility includes market stalls
 * * @field isHawkerCentre - Derived flag indicating if facility includes hawker stalls
 */
export const rawGovMarketsHawkerCentres = sqliteTable('rawGovMarketsHawkerCentres', {
  id: integer('id').primaryKey(),
  datasetId: text('datasetId'),
  ingestedAt: text('ingestedAt'),
  nameOfCentre: text('nameOfCentre'),
  locationOfCentre: text('locationOfCentre'),
  typeOfCentre: text('typeOfCentre'),
  owner: text('owner'),
  noOfStalls: integer('noOfStalls'),
  noOfCookedFoodStalls: integer('noOfCookedFoodStalls'),
  noOfMktProduceStalls: integer('noOfMktProduceStalls'),
  isMarket: integer('isMarket', { mode: 'boolean' }),
  isHawkerCentre: integer('isHawkerCentre', { mode: 'boolean' }),
});

/**
 * **Hawker Centres (GeoJSON)**
 * * Spatial layer with geographic coordinates and detailed attributes
 * * @ai_usage Use this for spatial queries and mapping hawker centres
 * * Joinable to raw_gov_markets_hawker_centres via name matching
 * * @field latitude - Geographic latitude (WGS84)
 * * @field longitude - Geographic longitude (WGS84)
 * * @field geometryType - GeoJSON geometry type (usually "Point")
 * * @field status - Operational status of the hawker centre
 */
export const rawHawkerCentresGeojson = sqliteTable('rawHawkerCentresGeojson', {
  id: integer('id').primaryKey(),
  datasetId: text('datasetId'),
  ingestedAt: text('ingestedAt'),
  name: text('name'),
  description: text('description'),
  status: text('status'),
  addressMyenv: text('addressMyenv'),
  addressBuildingName: text('addressBuildingName'),
  addressPostalCode: text('addressPostalCode'),
  addressStreetName: text('addressStreetName'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  geometryType: text('geometryType'),
  numberOfCookedFoodStalls: integer('numberOfCookedFoodStalls'),
  estOriginalCompletionDate: text('estOriginalCompletionDate'),
  implementationDate: text('implementationDate'),
  awardedDate: text('awardedDate'),
});

/**
 * **Hawker Stalls Annual**
 * * Time-series data showing historical hawker stall counts
 * * @ai_usage Use this for trending analysis of hawker stall supply over time
 * * @field year - Year of the data point
 * * @field noHawkerStalls - Total number of hawker stalls in that year
 */
export const rawHawkerStallsAnnual = sqliteTable('rawHawkerStallsAnnual', {
  id: integer('id').primaryKey(),
  datasetId: text('datasetId'),
  ingestedAt: text('ingestedAt'),
  year: integer('year'),
  noHawkerStalls: integer('noHawkerStalls'),
});


// ==========================================
// TRANSPORT INFRASTRUCTURE
// ==========================================

/**
 * **LTA MRT Stations**
 * * Master list of MRT/LRT stations with coordinates
 * * @ai_usage Use this for proximity analysis to public transport
 * * @field stationCode - Unique station code (e.g., NS1, EW12)
 * * @field lineCode - MRT line identifier
 */
export const rawLtaMrtStations = sqliteTable('rawLtaMrtStations', {
  stationCode: text('stationCode').primaryKey(),
  stationName: text('stationName'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  lineCode: text('lineCode'),
  ingestedAt: text('ingestedAt'),
});

/**
 * **LTA Bus Stops**
 * * Comprehensive list of bus stops with coordinates
 * * @ai_usage Use this for bus accessibility analysis
 * * @field busStopCode - Unique 5-digit bus stop code
 */
export const rawLtaBusStops = sqliteTable('rawLtaBusStops', {
  busStopCode: text('busStopCode').primaryKey(),
  roadName: text('roadName'),
  description: text('description'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  ingestedAt: text('ingestedAt'),
});


// ==========================================
// REALTOR AGENT & LEARNING SYSTEM
// ==========================================

/**
 * **User Preference Profiles**
 * * User preferences with dynamic learning weights adjusted by the agent
 * * @ai_usage Use this to understand user preferences and calculate property match scores
 * * @field weightPrice - Dynamic weight for price importance (adjusted by learning)
 * * @field weightProximityMrt - Dynamic weight for MRT proximity importance
 * * @field weightLeaseLife - Dynamic weight for remaining lease importance
 */
export const userPreferenceProfiles = sqliteTable('userPreferenceProfiles', {
  userId: text('userId').primaryKey(),
  budgetMin: integer('budgetMin'),
  budgetMax: integer('budgetMax'),
  preferredTowns: text('preferredTowns'),  // JSON Array
  flatTypes: text('flatTypes'),            // JSON Array
  amenities: text('amenities'),             // JSON Array

  // Dynamic Learning Weights
  weightPrice: real('weightPrice').default(sql`1.0`),
  weightProximityMrt: real('weightProximityMrt').default(sql`1.0`),
  weightLeaseLife: real('weightLeaseLife').default(sql`1.0`),

  lastRunAt: text('lastRunAt'),
  createdAt: text('createdAt').default(sql`(datetime('now'))`),
  updatedAt: text('updatedAt').default(sql`(datetime('now'))`),
});

/**
 * **Agent Chat Logs**
 * * Conversation history between user and agent
 * * @ai_usage Use this for context in conversations and for learning user preferences
 * * @field role - 'user' or 'agent'
 * * @field insightExtracted - Boolean indicating if Learner has processed this message
 */
export const agentChatLogs = sqliteTable('agentChatLogs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('userId').notNull(),
  role: text('role').notNull(),  // 'user' or 'agent'
  messageContent: text('messageContent').notNull(),
  insightExtracted: integer('insightExtracted', { mode: 'boolean' }).default(false),
  createdAt: text('createdAt').default(sql`(datetime('now'))`),
});

/**
 * **User Feedback Events**
 * * User actions on properties for learning preferences
 * * @ai_usage Use this to learn user preferences and adjust weights
 * * @field actionType - 'STAR', 'DISMISS', 'RATE_LOCATION'
 */
export const userFeedbackEvents = sqliteTable('userFeedbackEvents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('userId').notNull(),
  propertyId: text('propertyId'),  // Reference like "block-street"
  actionType: text('actionType').notNull(),  // 'STAR', 'DISMISS', 'RATE_LOCATION'
  notes: text('notes'),
  createdAt: text('createdAt').default(sql`(datetime('now'))`),
});


// ==========================================
// AI INSIGHTS & MEMORY
// ==========================================

/**
 * **User Insights**
 * * High-level analysis of user behavior and traits derived by the Analyst Agent.
 * * @ai_usage Use this to personalize the persona (e.g. "You seem risk-averse, so I'll suggest mature estates").
 */
export const userInsights = sqliteTable('userInsights', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('userId').notNull(),
  type: text('type').notNull(), // e.g., 'RISK_PROFILE', 'PREFERENCE_SUMMARY', 'INVESTMENT_GOAL'
  content: text('content').notNull(), // Textual insight
  confidence: real('confidence').default(1.0), // 0.0 to 1.0
  createdAt: text('createdAt').default(sql`(datetime('now'))`),
});

/**
 * **Property Insights**
 * * AI-generated evaluations of specific properties or towns.
 * * @ai_usage Source this for "Why this property?" explanations.
 */
export const propertyInsights = sqliteTable('propertyInsights', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  propertyId: text('propertyId').notNull(), // Generic reference (e.g. "BEDOK-BLK-123")
  type: text('type').notNull(), // 'VALUATION_ANALYSIS', 'RENTAL_YIELD_FORECAST', 'GROWTH_POTENTIAL'
  content: text('content').notNull(),
  confidence: real('confidence').default(1.0),
  createdAt: text('createdAt').default(sql`(datetime('now'))`),
});

/**
 * **User Portfolio**
 * * Properties currently owned by the user.
 * * @ai_usage Use this to calculate "Sell vs Hold" scenarios.
 */
export const userPortfolio = sqliteTable('userPortfolio', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('userId').notNull(),
  propertyId: text('propertyId'), // Text reference or link to trackedProperties
  acquisitionDate: text('acquisitionDate'),
  purchasePrice: real('purchasePrice'),
  currentValuation: real('currentValuation'), // Updated periodically by Analyst
  createdAt: text('createdAt').default(sql`(datetime('now'))`),
});


/**
 * **Policy Pages**
 * * Registry of all tracked policy URLs (crawled).
 */
export const policyPages = sqliteTable('policy_pages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  url: text('url').notNull().unique(),
  slug: text('slug').notNull(),
  canonicalUrl: text('canonical_url'),
  policyIdentifier: text('policy_identifier'),
  source: text('source').notNull(), // 'HDB', 'URA', 'UserSubmitted'
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * **Policy Versions**
 * * Version history of policy content.
 */
export const policyVersions = sqliteTable('policy_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  policyPageId: integer('policy_page_id').notNull().references(() => policyPages.id),
  versionNumber: integer('version_number').notNull(),
  contentMarkdown: text('content_markdown').notNull(),
  contentHash: text('content_hash').notNull(),
  scrapedAt: text('scraped_at').notNull(),
  effectiveDate: text('effective_date'),
  superseded: integer('superseded', { mode: 'boolean' }).notNull().default(false),
  aiKeywordsJson: text('ai_keywords_json'), // JSON array
  aiMetadataJson: text('ai_metadata_json'), // JSON object
});

/**
 * **Policy Embeddings**
 * * Vector embeddings for policy chunks.
 * * Note: Vector data lives in Cloudflare Vectorize, this links chunks to versions.
 */
export const policyEmbeddings = sqliteTable('policy_embeddings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  policyVersionId: integer('policy_version_id').notNull().references(() => policyVersions.id),
  vectorId: text('vector_id').notNull().unique(), // Format: "verId:chunkIdx"
  chunkIndex: integer('chunk_index').notNull(),
  textChunk: text('text_chunk').notNull(),
  createdAt: text('created_at').notNull(),
});

/**
 * **User Profiles (Policy Impact)**
 * * Detailed user profiles for impact analysis.
 */
export const userProfiles = sqliteTable('user_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  externalUserId: text('external_user_id').notNull().unique(),
  birthYear: integer('birth_year').notNull(),
  citizenshipCountry: text('citizenship_country').notNull(),
  primaryResidenceCountry: text('primary_residence_country').notNull(),
  intendsRetireInSingapore: integer('intends_retire_in_singapore', { mode: 'boolean' }).notNull().default(false),
  lastUpdatedAt: text('last_updated_at').notNull(),
  rawProfileJson: text('raw_profile_json'),
});

/**
 * **Policy User Impacts**
 * * Pre-computed AI analysis of how a policy affects a specific user.
 */
export const policyUserImpacts = sqliteTable('policy_user_impacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userProfileId: integer('user_profile_id').notNull().references(() => userProfiles.id),
  policyVersionId: integer('policy_version_id').notNull().references(() => policyVersions.id),
  analysisModel: text('analysis_model').notNull(),
  warningsJson: text('warnings_json').notNull(),
  benefitsJson: text('benefits_json').notNull(),
  summaryJson: text('summary_json').notNull(),
  createdAt: text('created_at').notNull(),
  lastRefreshedAt: text('last_refreshed_at').notNull(),
});

/**
 * **User Policy Considerations**
 * * Additional qualitative notes from the user for AI context.
 * * @ai_usage Include 'notes' in the system prompt for RAG and Impact Analysis.
 */
export const userPolicyConsiderations = sqliteTable('user_policy_considerations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userProfileId: integer('user_profile_id').notNull().references(() => userProfiles.id),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ==========================================
// SCAFFOLDED DATASETS
// ==========================================

export const rawHdbExistingBuilding = sqliteTable('raw_hdb_existing_building', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid: integer('OBJECTID'),
  blkNo: integer('BLK_NO'),
  stCod: text('ST_COD'),
  entityid: integer('ENTITYID'),
  postalCod: integer('POSTAL_COD'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
  shapeArea: integer('SHAPE.AREA'),
  shapeLen: integer('SHAPE.LEN'),
});

export const rawSgPreschoolCentres = sqliteTable('raw_sg_preschool_centres', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid1: integer('OBJECTID_1'),
  lCode: text('L_CODE'),
  name: text('NAME'),
  nReserve: integer('N_RESERVE'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
  shape1Area: integer('SHAPE_1.AREA'),
  shape1Len: integer('SHAPE_1.LEN'),
});

export const rawSgStudentCareCentres = sqliteTable('raw_sg_student_care_centres', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  name: text('Name'),
  description: text('Description'),
});

export const rawSgSchoolDirectory = sqliteTable('raw_sg_school_directory', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid: integer('OBJECTID'),
  venue: text('VENUE'),
  addressblockhousenumber: integer('ADDRESSBLOCKHOUSENUMBER'),
  addressstreetname: text('ADDRESSSTREETNAME'),
  postalCode: integer('POSTAL_CODE'),
  details: text('DETAILS'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
});

export const rawSgCarparkHdb = sqliteTable('raw_sg_carpark_hdb', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  name: text('Name'),
  description: text('Description'),
});

export const rawSgCarparkUra = sqliteTable('raw_sg_carpark_ura', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid: integer('OBJECTID'),
  uniqueid: text('UNIQUEID'),
  name: text('NAME'),
  class: text('CLASS'),
  additionalInfo: text('ADDITIONAL_INFO'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
});

export const rawSgTaxiStands = sqliteTable('raw_sg_taxi_stands', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid: integer('OBJECTID'),
  name: text('NAME'),
  x: integer('X'),
  y: integer('Y'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
});

export const rawSgBusStops = sqliteTable('raw_sg_bus_stops', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  name: text('Name'),
  description: text('Description'),
});

export const rawSgMrtStationExits = sqliteTable('raw_sg_mrt_station_exits', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid1: integer('OBJECTID_1'),
  lastUpdated: integer('LAST_UPDATED'),
  name: text('NAME'),
  description: text('DESCRIPTION'),
  status: text('STATUS'),
  estmtCnstrnCmcmnt: text('ESTMT_CNSTRN_CMCMNT'),
  estmtCnstrnCmpltn: text('ESTMT_CNSTRN_CMPLTN'),
  cnstrnCmcmnt: integer('CNSTRN_CMCMNT'),
  implmtOrg: text('IMPLMT_ORG'),
  qsmContact: text('QSM_CONTACT'),
  ctrctrName: integer('CTRCTR_NAME'),
  ctrctrCntct: integer('CTRCTR_CNTCT'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
  shapeArea: integer('SHAPE.AREA'),
  shapeLen: integer('SHAPE.LEN'),
});

export const rawSgCyclingNetwork = sqliteTable('raw_sg_cycling_network', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  name: text('Name'),
  description: text('Description'),
});

export const rawSgTrafficIncidents = sqliteTable('raw_sg_traffic_incidents', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid: integer('OBJECTID'),
  grndLevel: text('GRND_LEVEL'),
  railType: text('RAIL_TYPE'),
  name: text('NAME'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
  shapeArea: integer('SHAPE.AREA'),
  shapeLen: integer('SHAPE.LEN'),
});

export const rawSgTrafficSpeedBands = sqliteTable('raw_sg_traffic_speed_bands', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid: integer('OBJECTID'),
  featureid: integer('FEATUREID'),
  zorder: integer('ZORDER'),
  annotationclassid: integer('ANNOTATIONCLASSID'),
  symbolid: integer('SYMBOLID'),
  status: integer('STATUS'),
  textstring: text('TEXTSTRING'),
  fontname: text('FONTNAME'),
  fontsize: integer('FONTSIZE'),
  bold: integer('BOLD'),
  italic: integer('ITALIC'),
  underline: integer('UNDERLINE'),
  verticalalignment: integer('VERTICALALIGNMENT'),
  horizontalalignment: integer('HORIZONTALALIGNMENT'),
  xoffset: integer('XOFFSET'),
  yoffset: integer('YOFFSET'),
  angle: integer('ANGLE'),
  fontleading: integer('FONTLEADING'),
  wordspacing: integer('WORDSPACING'),
  characterwidth: integer('CHARACTERWIDTH'),
  characterspacing: integer('CHARACTERSPACING'),
  flipangle: integer('FLIPANGLE'),
  override: integer('OVERRIDE'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
  shapeArea: integer('SHAPE.AREA'),
  shapeLen: integer('SHAPE.LEN'),
});

export const rawSgSupermarkets = sqliteTable('raw_sg_supermarkets', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  name: text('Name'),
  description: text('Description'),
});

export const rawSgEatingEstablishments = sqliteTable('raw_sg_eating_establishments', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  name: text('Name'),
  description: text('Description'),
});

export const rawSgSportsFacilities = sqliteTable('raw_sg_sports_facilities', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid: integer('OBJECTID'),
  hyperlink: text('HYPERLINK'),
  description: integer('DESCRIPTION'),
  postalcode: integer('POSTALCODE'),
  keepername: text('KEEPERNAME'),
  totalrooms: integer('TOTALROOMS'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
  name: text('NAME'),
});

export const rawSgCommunityClubs = sqliteTable('raw_sg_community_clubs', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid: integer('OBJECTID'),
  addresspostalcode: integer('ADDRESSPOSTALCODE'),
  landxaddresspoint: integer('LANDXADDRESSPOINT'),
  landyaddresspoint: integer('LANDYADDRESSPOINT'),
  addressblockhousenumber: integer('ADDRESSBLOCKHOUSENUMBER'),
  addressbuildingname: text('ADDRESSBUILDINGNAME'),
  addressfloornumber: integer('ADDRESSFLOORNUMBER'),
  addressstreetname: text('ADDRESSSTREETNAME'),
  addresstype: integer('ADDRESSTYPE'),
  description: text('DESCRIPTION'),
  name: text('NAME'),
  hyperlink: integer('HYPERLINK'),
  photourl: integer('PHOTOURL'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
  addressunitnumber: integer('ADDRESSUNITNUMBER'),
});

export const rawSgPublicLibraries = sqliteTable('raw_sg_public_libraries', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid: integer('OBJECTID'),
  addressblockhousenumber: integer('ADDRESSBLOCKHOUSENUMBER'),
  addressbuildingname: integer('ADDRESSBUILDINGNAME'),
  addressfloornumber: integer('ADDRESSFLOORNUMBER'),
  addresspostalcode: integer('ADDRESSPOSTALCODE'),
  addressstreetname: text('ADDRESSSTREETNAME'),
  addresstype: integer('ADDRESSTYPE'),
  description: text('DESCRIPTION'),
  hyperlink: integer('HYPERLINK'),
  landxaddresspoint: integer('LANDXADDRESSPOINT'),
  landyaddresspoint: integer('LANDYADDRESSPOINT'),
  name: text('NAME'),
  photourl: integer('PHOTOURL'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
  addressunitnumber: integer('ADDRESSUNITNUMBER'),
});

export const rawSgMuseums = sqliteTable('raw_sg_museums', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  name: text('Name'),
  description: text('Description'),
});

export const rawSgChasClinics = sqliteTable('raw_sg_chas_clinics', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  name: text('Name'),
  description: text('Description'),
});

export const rawSgPoliceEstablishments = sqliteTable('raw_sg_police_establishments', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  name: text('Name'),
  description: text('Description'),
});

export const rawSgFireStations = sqliteTable('raw_sg_fire_stations', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid: integer('OBJECTID'),
  addressblockhousenumber: integer('ADDRESSBLOCKHOUSENUMBER'),
  addressbuildingname: integer('ADDRESSBUILDINGNAME'),
  addressfloornumber: integer('ADDRESSFLOORNUMBER'),
  addresspostalcode: integer('ADDRESSPOSTALCODE'),
  addressstreetname: text('ADDRESSSTREETNAME'),
  addresstype: integer('ADDRESSTYPE'),
  description: integer('DESCRIPTION'),
  hyperlink: integer('HYPERLINK'),
  landxaddresspoint: integer('LANDXADDRESSPOINT'),
  landyaddresspoint: integer('LANDYADDRESSPOINT'),
  name: text('NAME'),
  photourl: integer('PHOTOURL'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
  addressunitnumber: integer('ADDRESSUNITNUMBER'),
});

export const rawSgDengueClusters = sqliteTable('raw_sg_dengue_clusters', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid: integer('OBJECTID'),
  oid: integer('OID'),
  luDesc: text('LU_DESC'),
  luText: text('LU_TEXT'),
  gpr: text('GPR'),
  whiteQMx: integer('WHITE_Q_MX'),
  gprBMin: integer('GPR_B_MIN'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
  shapeArea: integer('SHAPE.AREA'),
  shapeLen: integer('SHAPE.LEN'),
});

export const rawSgRainfallReadings = sqliteTable('raw_sg_rainfall_readings', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid: integer('OBJECTID'),
  luDesc: text('LU_DESC'),
  luText: integer('LU_TEXT'),
  gpr: text('GPR'),
  whiQMx: integer('WHI_Q_MX'),
  gprBMn: integer('GPR_B_MN'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
  shapeArea: integer('SHAPE.AREA'),
  shapeLen: integer('SHAPE.LEN'),
});

export const rawSgInfantCare = sqliteTable('raw_sg_infant_care', {
  id: text('id').primaryKey(), // Using text ID for composed ID
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  dataSeries: text('DataSeries'),
  year: integer('year'),
  value: integer('value'),
});

export const rawSgParkConnector = sqliteTable('raw_sg_park_connector', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  objectid: integer('OBJECTID'),
  prpStatus: text('PRP_STATUS'),
  incCrc: text('INC_CRC'),
  fmelUpdD: integer('FMEL_UPD_D'),
  shapeLen: integer('SHAPE.LEN'),
});

export const rawSgSportsFields = sqliteTable('raw_sg_sports_fields', {
  id: integer('id').primaryKey(),
  datasetId: text('dataset_id'),
  ingestedAt: text('ingested_at'),
  name: text('Name'),
  description: text('Description'),
});




/**
 * **Enriched HDB Blocks**
 * * The Master Record for every physical HDB block in Singapore.
 * * Contains geocoordinates and unit composition.
 * * @ai_usage Query this to find specific buildings. Filter by `town` or `max_floor_lvl`.
 * * Use `latitude`/`longitude` for radius searches.
 */
export const enrichedHdbBlocks = sqliteTable('enriched_hdb_blocks', {
    id: integer('id').primaryKey(),
    rawPropertyId: integer('raw_property_id').references(() => rawHdbPropertyInfo.id),
    block: text('block').notNull(),
    street: text('street').notNull(),
    town: text('town').notNull(),
    postalCode: text('postal_code'),
    latitude: real('latitude'), // CRITICAL for mapping
    longitude: real('longitude'),
    yearCompleted: integer('year_completed'),
    // Determining "Rarity"
    totalUnits: integer('total_units'),
    hasCommercial: integer('has_commercial', { mode: 'boolean' }),
});

/**
 * **Block Amenities Cache**
 * * Pre-computed distances to key lifestyle nodes.
 * * @ai_usage Use to answer "How close is the nearest MRT?". Filter by `amenity_type`.
 */
export const enrichedBlockAmenities = sqliteTable('enriched_block_amenities', {
    id: integer('id').primaryKey(),
    blockId: integer('block_id').references(() => enrichedHdbBlocks.id),
    amenityType: text('amenity_type').notNull(), // 'MRT', 'HAWKER', 'BUS'
    amenityName: text('amenity_name').notNull(),
    distanceMeters: real('distance_meters').notNull(),
    isSheltered: integer('is_sheltered', { mode: 'boolean' }), // Bonus if you can infer this
});

/**
 * **Block Market Metrics**
 * * Financial performance of specific blocks.
 * * @ai_usage Use for "High Yield" or "Undervalued" queries.
 */
export const analyticsBlockMetrics = sqliteTable('analytics_block_metrics', {
    id: integer('id').primaryKey(),
    blockId: integer('block_id').references(() => enrichedHdbBlocks.id),
    lastUpdated: text('last_updated'),

    // Financials
    medianResalePrice: real('median_resale_price'),
    medianRent: real('median_rent'),
    impliedRentalYield: real('implied_rental_yield'), // The "Investor" metric
    pricePerSqm: real('price_per_sqm'),

    // Liquidity
    salesVolumeLastYear: integer('sales_volume_last_year'),

    // Scores (0-10)
    walkabilityScore: real('walkability_score'),
    foodAccessScore: real('food_access_score'),
});

/**
 * **Neighborhood Scores**
 * * Aggregated metrics for neighborhoods/towns.
 * * @ai_usage Use for heatmap visualizations and high-level area comparisons.
 */
export const analyticsNeighborhoodScores = sqliteTable('analytics_neighborhood_scores', {
    id: integer('id').primaryKey(),
    town: text('town').notNull(),
    walkabilityScore: real('walkability_score'), // 0-100
    foodAccessibilityScore: real('food_accessibility_score'), // 0-100
    transportScore: real('transport_score'), // 0-100
});

/**
 * **AI Property Listings**
 * * "Realtor-style" narratives and explanations generated by LLMs.
 * * @ai_usage Use this to display the "AI Realtor Pitch" on the frontend.
 */
export const aiPropertyListings = sqliteTable('ai_property_listings', {
    id: integer('id').primaryKey(),
    blockId: integer('block_id').references(() => enrichedHdbBlocks.id).notNull(),

    // Content - AI Generated
    listingNarrative: text('listing_narrative'), // The "Realtor Pitch"
    overallReasoning: text('overall_reasoning'), // High-level summary

    // Analysis Lists (JSON arrays)
    proList: text('pro_list'), // e.g. ["High rental yield", "Near MRT"]
    conList: text('con_list'), // e.g. ["Short remaining lease", "Noisy area"]

    // Metadata
    modelName: text('model_name'),
    promptUsed: text('prompt_used'),
    generatedAt: text('generated_at').notNull(),
});

/**
 * **HDB Valuation Data**
 * * Granular financial breakdown per flat type within a block.
 */
export const hdbValuationData = sqliteTable('hdb_valuation_data', {
    id: integer('id').primaryKey(),
    blockId: integer('block_id').references(() => enrichedHdbBlocks.id).notNull(),
    flatType: text('flat_type').notNull(), // '3-ROOM', '4-ROOM'

    // Buy Valuation
    estMinValBuy: real('est_min_val_buy'),
    estAvgValBuy: real('est_avg_val_buy'),
    estMaxValBuy: real('est_max_val_buy'),

    // Rent Valuation
    estMinValRent: real('est_min_val_rent'),
    estAvgValRent: real('est_avg_val_rent'),
    estMaxValRent: real('est_max_val_rent'),

    // Market Depth
    totalUnits: integer('total_units'),
    latestPurchaseDate: text('latest_purchase_date'),
    avgAnnualPurchases: real('avg_annual_purchases'),
    impliedRentalYield: real('implied_rental_yield'),
    salesVolumeLastYear: integer('sales_volume_last_year'),

    lastEnrichedAt: text('last_enriched_at'),
});

/**
 * **HDB Score-Lah!**
 * * Detailed scoring for lifestyle and investability.
 */
export const hdbScoreLah = sqliteTable('hdb_score_lah', {
    id: integer('id').primaryKey(),
    blockId: integer('block_id').references(() => enrichedHdbBlocks.id).notNull(),

    scoreLah: integer('score_lah'), // Overall Score
    scoreLahRationale: text('score_lah_rationale'),

    // Component Scores (0-100)
    walkability: integer('walkability'),
    walkabilityRationale: text('walkability_rationale'),

    foodAccess: integer('food_access'),
    foodAccessRationale: text('food_access_rationale'),

    hawker: integer('hawker'),
    hawkerRationale: text('hawker_rationale'),

    mrt: integer('mrt'),
    mrtRationale: text('mrt_rationale'),

    bus: integer('bus'),
    busRationale: text('bus_rationale'),

    education: integer('education'),
    educationRationale: text('education_rationale'),

    parks: integer('parks'),
    parksRationale: text('parks_rationale'),

    // Other metrics (Lower is better)
    noiseLevel: integer('noise_level'), // 0-10
    noiseLevelRationale: text('noise_level_rationale'),

    trafficLevel: integer('traffic_level'), // 0-10
    trafficLevelRationale: text('traffic_level_rationale'),
});

/**
 * **User Portfolio**
 * * Tracks properties owned or tracked by users.
 */
export const userPortfolio = sqliteTable('user_portfolio', {
    id: integer('id').primaryKey(),
    userId: text('user_id').notNull(), // UUID from Auth system
    blockId: integer('block_id').references(() => enrichedHdbBlocks.id).notNull(),

    // Specific Unit Details
    flatType: text('flat_type'), // '4-ROOM'
    unitNumber: text('unit_number'), // Optional (Encrypted concept)

    // Status
    ownershipStatus: text('ownership_status').notNull(), // 'OWNED', 'INHERITANCE_FUTURE', 'TRACKING'

    // Financials
    acquisitionDate: text('acquisition_date'),
    acquisitionPrice: real('acquisition_price'),
    currentRent: real('current_rent'), // If rented out

    createdAt: text('created_at').notNull(),
});

/**
 * **Portfolio Analysis**
 * * AI-driven insights for specific portfolio items.
 */
export const portfolioAnalysis = sqliteTable('portfolio_analysis', {
    id: integer('id').primaryKey(),
    portfolioId: integer('portfolio_id').references(() => userPortfolio.id).notNull(),
    generatedAt: text('generated_at').notNull(),

    // Rent Analysis
    rentGap: real('rent_gap'), // (Current Rent - Market Avg)
    rentAdvice: text('rent_advice'), // AI text: "Raise rent by $200"

    // Resale Analysis
    marketValueGap: real('market_value_gap'), // (Est. Value - Acquisition Price)
    resaleOutlook: text('resale_outlook'), // "Bullish", "Bearish", "Stable"
    // Lifestyle/Score Impact
    scoreLahImpact: text('score_lah_impact'), // "High walkability adds ~$20k value"

    // Strategic Advice
    aiActionItems: text('ai_action_items'), // JSON list: ["Renovate kitchen", "Review lease"]
});

/**
 * **HDB Frontend Data**
 * * Pre-generated assets and links for UI display.
 */
export const hdbFrontendData = sqliteTable('hdb_frontend_data', {
    id: integer('id').primaryKey(),
    blockId: integer('block_id').references(() => enrichedHdbBlocks.id).notNull(),
    googleStreetViewUrl: text('google_street_view_url'),
    lastEnrichedAt: text('last_enriched_at'),
});

// Type Exports
export type EnrichedHdbBlock = InferSelectModel<typeof enrichedHdbBlocks>;
export type HdbScoreLah = InferSelectModel<typeof hdbScoreLah>;
export type HdbValuationData = InferSelectModel<typeof hdbValuationData>;
export type HdbFrontendData = InferSelectModel<typeof hdbFrontendData>;
export type UserPortfolio = InferSelectModel<typeof userPortfolio>;
export type PortfolioAnalysis = InferSelectModel<typeof portfolioAnalysis>;

export type NewPortfolioAnalysis = InferInsertModel<typeof portfolioAnalysis>;

