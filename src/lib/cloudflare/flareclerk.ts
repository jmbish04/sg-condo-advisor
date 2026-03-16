export const PRICING = {
  workerRequests: { included: 10_000_000, rate: 0.30 / 1_000_000 },
  workerCpuMs: { included: 30_000_000, rate: 0.02 / 1_000_000 },
  doRequests: { included: 1_000_000, rate: 0.15 / 1_000_000 },
  doGbSeconds: { included: 400_000, rate: 12.50 / 1_000_000 },
  containerVcpuSec: { included: 375 * 60, rate: 0.000020 },
  containerMemGibSec: { included: 25 * 3600, rate: 0.0000025 },
  containerDiskGbSec: { included: 200 * 3600, rate: 0.00000007 },
  containerEgressGb: { included: 0, rate: 0.025 },
  doStorageReadUnits: { included: 1_000_000, rate: 0.20 / 1_000_000 },
  doStorageWriteUnits: { included: 1_000_000, rate: 1.00 / 1_000_000 },
  doStorageDeletes: { included: 1_000_000, rate: 1.00 / 1_000_000 },
  doSqlRowsRead: { included: 25_000_000_000, rate: 0.001 / 1_000_000 },
  doSqlRowsWritten: { included: 50_000_000, rate: 1.00 / 1_000_000 },
  doSqlStorageGb: { included: 5, rate: 0.20 },
  d1RowsRead: { included: 25_000_000_000, rate: 0.001 / 1_000_000 },
  d1RowsWritten: { included: 50_000_000, rate: 1.00 / 1_000_000 },
  d1StorageGb: { included: 5, rate: 0.75 },
  kvReads: { included: 10_000_000, rate: 0.50 / 1_000_000 },
  kvWrites: { included: 1_000_000, rate: 5.00 / 1_000_000 },
  kvStorageGb: { included: 1, rate: 0.50 },
  platform: 5.0,
};

export const METRIC_KEYS = [
  "workerRequests", "workerCpuMs", "doRequests", "doGbSeconds", "containerVcpuSec",
  "containerMemGibSec", "containerDiskGbSec", "containerEgressGb", "doStorageReadUnits",
  "doStorageWriteUnits", "doStorageDeletes", "doSqlRowsRead", "doSqlRowsWritten",
  "doSqlStorageGb", "d1RowsRead", "d1RowsWritten", "d1StorageGb", "kvReads",
  "kvWrites", "kvStorageGb"
] as const;

export class FlareclerkService {
  constructor(private accountId: string, private apiToken: string) {}

  private async cfApi(method: string, path: string, body?: any) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
    };
    if (body && typeof body === "object") {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`CF API ${method} ${path}: ${res.status} ${await res.text()}`);
    }

    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
  }

  private async cfGraphQL(query: string, variables: any) {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      throw new Error(`CF GraphQL: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as any;
    if (json.errors?.length > 0) {
      throw new Error(`CF GraphQL: ${json.errors.map((e: any) => e.message).join(", ")}`);
    }
    return json.data;
  }

  async getWorkerSettings(scriptName: string) {
    const res = await this.cfApi("GET", `/accounts/${this.accountId}/workers/scripts/${scriptName}/settings`);
    return (res as any).result;
  }

  async listContainerApps() {
    const res = await this.cfApi("GET", `/accounts/${this.accountId}/containers/applications`);
    return (res as any).result || [];
  }

  async listWorkerScripts() {
    const res = await this.cfApi("GET", `/accounts/${this.accountId}/workers/scripts`);
    return (res as any).result || [];
  }

  async listD1Databases() {
    const res = await this.cfApi("GET", `/accounts/${this.accountId}/d1/database`);
    return (res as any).result || [];
  }

  async listKVNamespaces() {
    const res = await this.cfApi("GET", `/accounts/${this.accountId}/storage/kv/namespaces`);
    return (res as any).result || [];
  }

  async discoverWorker(scriptName: string) {
    const settings = await this.getWorkerSettings(scriptName);
    const bindings = settings?.bindings || [];
    const doBinding = bindings.find((b: any) => b.type === "durable_object_namespace");
    
    const d1DatabaseIds = bindings.filter((b: any) => b.type === "d1").map((b: any) => b.id).filter(Boolean);
    const kvNamespaceIds = bindings.filter((b: any) => b.type === "kv_namespace").map((b: any) => b.namespace_id).filter(Boolean);

    let className: string | null = null;
    let namespaceId: string | null = null;
    let containerAppId = null;

    if (doBinding) {
      className = doBinding.class_name;
      const [doRes, containerApps] = await Promise.all([
        this.cfApi("GET", `/accounts/${this.accountId}/workers/durable_objects/namespaces`),
        this.listContainerApps(),
      ]);
      const namespaces = (doRes as any).result || [];
      const ns = namespaces.find((n: any) => n.script === scriptName && n.class === className);
      namespaceId = ns ? ns.id : null;
      const containerApp = containerApps.find((a: any) => a.durable_objects?.namespace_id === namespaceId);
      containerAppId = containerApp?.id || null;
    }

    return { scriptName, className, namespaceId, containerAppId, d1DatabaseIds, kvNamespaceIds };
  }

  async discoverFleet() {
    const [scripts, doRes, containerApps] = await Promise.all([
      this.listWorkerScripts(),
      this.cfApi("GET", `/accounts/${this.accountId}/workers/durable_objects/namespaces`),
      this.listContainerApps(),
    ]);

    const doNamespaces = (doRes as any).result || [];
    const settingsMap: Record<string, any> = {};
    
    await Promise.all(
      scripts.map(async (s: any) => {
        try {
          const settings = await this.getWorkerSettings(s.id);
          settingsMap[s.id] = settings?.bindings || [];
        } catch {
          settingsMap[s.id] = [];
        }
      })
    );

    const nsByScript: Record<string, string[]> = {};
    for (const ns of doNamespaces) {
      if (!nsByScript[ns.script]) nsByScript[ns.script] = [];
      nsByScript[ns.script].push(ns.id);
    }

    const containerByNs: Record<string, string> = {};
    for (const ca of containerApps) {
      if (ca.durable_objects?.namespace_id) {
        containerByNs[ca.durable_objects.namespace_id] = ca.id;
      }
    }

    return scripts.map((s: any) => {
      const nsIds = nsByScript[s.id] || [];
      let containerAppId = null;
      let namespaceId = null;
      for (const nsId of nsIds) {
        if (containerByNs[nsId]) {
          containerAppId = containerByNs[nsId];
          namespaceId = nsId;
          break;
        }
      }
      if (!namespaceId && nsIds.length > 0) namespaceId = nsIds[0];

      const bindings = settingsMap[s.id] || [];
      const d1DatabaseIds = bindings.filter((b: any) => b.type === "d1").map((b: any) => b.id).filter(Boolean);
      const kvNamespaceIds = bindings.filter((b: any) => b.type === "kv_namespace").map((b: any) => b.namespace_id).filter(Boolean);

      return { scriptName: s.id, namespaceId, containerAppId, d1DatabaseIds, kvNamespaceIds };
    });
  }

  async fetchAnalytics(workers: any[], range: { sinceISO: string, untilISO: string, sinceDate: string, untilDate: string }) {
    const scriptNames = workers.map(w => w.scriptName);
    const namespaceIds = workers.map(w => w.namespaceId).filter(Boolean);
    const containerAppIds = workers.map(w => w.containerAppId).filter(Boolean);
    const d1DatabaseIds = [...new Set(workers.flatMap(w => w.d1DatabaseIds || []))];
    const kvNamespaceIds = [...new Set(workers.flatMap(w => w.kvNamespaceIds || []))];

    const queries = [];

    queries.push(this.cfGraphQL(`query Workers($accountTag: string!, $filter: WorkersInvocationsAdaptiveFilter_InputObject!) { viewer { accounts(filter: { accountTag: $accountTag }) { workersInvocationsAdaptive(limit: 10000, filter: $filter) { dimensions { scriptName } sum { requests cpuTimeUs } avg { sampleInterval } } } } }`, {
      accountTag: this.accountId,
      filter: { datetimeHour_geq: range.sinceISO, datetimeHour_leq: range.untilISO, scriptName_in: scriptNames },
    }));

    if (namespaceIds.length > 0) {
      const doFilter = { datetimeHour_geq: range.sinceISO, datetimeHour_leq: range.untilISO, namespaceId_in: namespaceIds };
      queries.push(this.cfGraphQL(`query DORequests($accountTag: string!, $filter: DurableObjectsInvocationsAdaptiveGroupsFilter_InputObject!) { viewer { accounts(filter: { accountTag: $accountTag }) { durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: $filter) { dimensions { namespaceId } sum { requests } avg { sampleInterval } } } } }`, { accountTag: this.accountId, filter: doFilter }));
      queries.push(this.cfGraphQL(`query DODuration($accountTag: string!, $filter: DurableObjectsPeriodicGroupsFilter_InputObject!) { viewer { accounts(filter: { accountTag: $accountTag }) { durableObjectsPeriodicGroups(limit: 10000, filter: $filter) { dimensions { namespaceId } sum { activeTime inboundWebsocketMsgCount storageReadUnits storageWriteUnits storageDeletes rowsRead rowsWritten } } } } }`, { accountTag: this.accountId, filter: doFilter }));
      queries.push(this.cfGraphQL(`query DOSqlStorage($accountTag: string!, $filter: AccountDurableObjectsSqlStorageGroupsFilter_InputObject!) { viewer { accounts(filter: { accountTag: $accountTag }) { durableObjectsSqlStorageGroups(limit: 10000, filter: $filter) { dimensions { namespaceId } max { storedBytes } } } } }`, { accountTag: this.accountId, filter: doFilter }));
    } else {
      queries.push(Promise.resolve(null), Promise.resolve(null), Promise.resolve(null));
    }

    if (containerAppIds.length > 0) {
      queries.push(this.cfGraphQL(`query Containers($accountTag: string!, $filter: AccountContainersMetricsAdaptiveGroupsFilter_InputObject!) { viewer { accounts(filter: { accountTag: $accountTag }) { containersMetricsAdaptiveGroups(limit: 10000, filter: $filter) { dimensions { applicationId } sum { cpuTimeSec allocatedMemory allocatedDisk txBytes } } } } }`, {
        accountTag: this.accountId,
        filter: { datetimeHour_geq: range.sinceISO, datetimeHour_leq: range.untilISO, applicationId_in: containerAppIds },
      }));
    } else {
      queries.push(Promise.resolve(null));
    }

    const dateFilter = { date_geq: range.sinceDate, date_leq: range.untilDate };
    if (d1DatabaseIds.length > 0) {
      queries.push(this.cfGraphQL(`query D1Queries($accountTag: string!, $filter: AccountD1QueriesAdaptiveGroupsFilter_InputObject!) { viewer { accounts(filter: { accountTag: $accountTag }) { d1QueriesAdaptiveGroups(limit: 10000, filter: $filter) { dimensions { databaseId } sum { rowsRead rowsWritten } } } } }`, { accountTag: this.accountId, filter: dateFilter }));
      queries.push(this.cfGraphQL(`query D1Storage($accountTag: string!, $filter: AccountD1StorageAdaptiveGroupsFilter_InputObject!) { viewer { accounts(filter: { accountTag: $accountTag }) { d1StorageAdaptiveGroups(limit: 10000, filter: $filter) { dimensions { databaseId } max { databaseSizeBytes } } } } }`, { accountTag: this.accountId, filter: dateFilter }));
    } else {
      queries.push(Promise.resolve(null), Promise.resolve(null));
    }

    if (kvNamespaceIds.length > 0) {
      queries.push(this.cfGraphQL(`query KVOps($accountTag: string!, $filter: AccountKvOperationsAdaptiveGroupsFilter_InputObject!) { viewer { accounts(filter: { accountTag: $accountTag }) { kvOperationsAdaptiveGroups(limit: 10000, filter: $filter) { dimensions { namespaceId actionType } sum { requests } } } } }`, { accountTag: this.accountId, filter: dateFilter }));
      queries.push(this.cfGraphQL(`query KVStorage($accountTag: string!, $filter: AccountKvStorageAdaptiveGroupsFilter_InputObject!) { viewer { accounts(filter: { accountTag: $accountTag }) { kvStorageAdaptiveGroups(limit: 10000, filter: $filter) { dimensions { namespaceId } max { byteCount } } } } }`, { accountTag: this.accountId, filter: dateFilter }));
    } else {
      queries.push(Promise.resolve(null), Promise.resolve(null));
    }

    queries.push(this.cfGraphQL(`query Logs($accountTag: string!, $filter: AccountLogExplorerIngestionAdaptiveGroupsFilter_InputObject!) { viewer { accounts(filter: { accountTag: $accountTag }) { logExplorerIngestionAdaptiveGroups(limit: 10000, filter: $filter) { sum { billableBytes } } } } }`, {
      accountTag: this.accountId,
      filter: { datetimeHour_geq: range.sinceISO, datetimeHour_leq: range.untilISO },
    }).catch(() => null));

    const [workersData, doReqData, doDurData, doSqlStorageData, containersData, d1QueriesData, d1StorageData, kvOpsData, kvStorageData, logsData] = await Promise.all(queries);
    return { workersData, doReqData, doDurData, doSqlStorageData, containersData, d1QueriesData, d1StorageData, kvOpsData, kvStorageData, logsData };
  }

  aggregateResults(workers: any[], analytics: any, prorata: number) {
    const { workersData, doReqData, doDurData, containersData, d1QueriesData, d1StorageData, kvOpsData, kvStorageData, doSqlStorageData } = analytics;
    
    const workersByScript: any = {};
    for (const row of workersData?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || []) {
      const sn = row.dimensions.scriptName;
      if (!workersByScript[sn]) workersByScript[sn] = { requests: 0, cpuMs: 0 };
      workersByScript[sn].requests += (row.sum?.requests || 0) * (row.avg?.sampleInterval || 1);
      workersByScript[sn].cpuMs += ((row.sum?.cpuTimeUs || 0) / 1000) * (row.avg?.sampleInterval || 1);
    }

    const doReqByNs: any = {};
    for (const row of doReqData?.viewer?.accounts?.[0]?.durableObjectsInvocationsAdaptiveGroups || []) {
      doReqByNs[row.dimensions.namespaceId] = (doReqByNs[row.dimensions.namespaceId] || 0) + (row.sum?.requests || 0) * (row.avg?.sampleInterval || 1);
    }

    const doDurByNs: any = {};
    for (const row of doDurData?.viewer?.accounts?.[0]?.durableObjectsPeriodicGroups || []) {
      const ns = row.dimensions.namespaceId;
      if (!doDurByNs[ns]) doDurByNs[ns] = { activeTime: 0, wsInbound: 0, storageReadUnits: 0, storageWriteUnits: 0, storageDeletes: 0, rowsRead: 0, rowsWritten: 0 };
      doDurByNs[ns].activeTime += row.sum?.activeTime || 0;
      doDurByNs[ns].wsInbound += row.sum?.inboundWebsocketMsgCount || 0;
      doDurByNs[ns].storageReadUnits += row.sum?.storageReadUnits || 0;
      doDurByNs[ns].storageWriteUnits += row.sum?.storageWriteUnits || 0;
      doDurByNs[ns].storageDeletes += row.sum?.storageDeletes || 0;
      doDurByNs[ns].rowsRead += row.sum?.rowsRead || 0;
      doDurByNs[ns].rowsWritten += row.sum?.rowsWritten || 0;
    }

    const containersByAppId: any = {};
    for (const row of containersData?.viewer?.accounts?.[0]?.containersMetricsAdaptiveGroups || []) {
      const appId = row.dimensions.applicationId;
      if (!containersByAppId[appId]) containersByAppId[appId] = { cpuTimeSec: 0, allocatedMemory: 0, allocatedDisk: 0, txBytes: 0 };
      containersByAppId[appId].cpuTimeSec += row.sum?.cpuTimeSec || 0;
      containersByAppId[appId].allocatedMemory += row.sum?.allocatedMemory || 0;
      containersByAppId[appId].allocatedDisk += row.sum?.allocatedDisk || 0;
      containersByAppId[appId].txBytes += row.sum?.txBytes || 0;
    }

    const d1QueryByDb: any = {};
    for (const row of d1QueriesData?.viewer?.accounts?.[0]?.d1QueriesAdaptiveGroups || []) {
      const id = row.dimensions.databaseId;
      if (!d1QueryByDb[id]) d1QueryByDb[id] = { rowsRead: 0, rowsWritten: 0 };
      d1QueryByDb[id].rowsRead += row.sum?.rowsRead || 0;
      d1QueryByDb[id].rowsWritten += row.sum?.rowsWritten || 0;
    }

    const d1StorageByDb: any = {};
    for (const row of d1StorageData?.viewer?.accounts?.[0]?.d1StorageAdaptiveGroups || []) {
      const id = row.dimensions.databaseId;
      d1StorageByDb[id] = Math.max(d1StorageByDb[id] || 0, row.max?.databaseSizeBytes || 0);
    }

    const kvOpsByNs: any = {};
    for (const row of kvOpsData?.viewer?.accounts?.[0]?.kvOperationsAdaptiveGroups || []) {
      const id = row.dimensions.namespaceId;
      if (!kvOpsByNs[id]) kvOpsByNs[id] = { reads: 0, writes: 0 };
      if (row.dimensions.actionType === "read") kvOpsByNs[id].reads += row.sum?.requests || 0;
      else kvOpsByNs[id].writes += row.sum?.requests || 0;
    }

    const kvStorageByNs: any = {};
    for (const row of kvStorageData?.viewer?.accounts?.[0]?.kvStorageAdaptiveGroups || []) {
      const id = row.dimensions.namespaceId;
      kvStorageByNs[id] = Math.max(kvStorageByNs[id] || 0, row.max?.byteCount || 0);
    }

    const doSqlStorageByNs: any = {};
    for (const row of doSqlStorageData?.viewer?.accounts?.[0]?.durableObjectsSqlStorageGroups || []) {
      const id = row.dimensions.namespaceId;
      doSqlStorageByNs[id] = Math.max(doSqlStorageByNs[id] || 0, row.max?.storedBytes || 0);
    }

    return workers.map((w) => {
      const wd = workersByScript[w.scriptName] || { requests: 0, cpuMs: 0 };
      const nsId = w.namespaceId;
      const doDuration = nsId ? doDurByNs[nsId] || {} : {};
      const doRequests = (nsId ? doReqByNs[nsId] || 0 : 0) + (doDuration.wsInbound || 0) / 20;

      const doSqlStorageBytes = nsId ? doSqlStorageByNs[nsId] || 0 : 0;
      const c = w.containerAppId ? containersByAppId[w.containerAppId] || {} : {};

      let d1RowsRead = 0, d1RowsWritten = 0, d1StorageBytes = 0;
      for (const dbId of w.d1DatabaseIds || []) {
        d1RowsRead += d1QueryByDb[dbId]?.rowsRead || 0;
        d1RowsWritten += d1QueryByDb[dbId]?.rowsWritten || 0;
        d1StorageBytes = Math.max(d1StorageBytes, d1StorageByDb[dbId] || 0);
      }

      let kvReads = 0, kvWrites = 0, kvStorageBytes = 0;
      for (const kvNsId of w.kvNamespaceIds || []) {
        kvReads += kvOpsByNs[kvNsId]?.reads || 0;
        kvWrites += kvOpsByNs[kvNsId]?.writes || 0;
        kvStorageBytes = Math.max(kvStorageBytes, kvStorageByNs[kvNsId] || 0);
      }

      return {
        name: w.scriptName,
        d1StorageBytes,
        kvStorageBytes,
        doSqlStorageBytes,
        usage: {
          workerRequests: Math.round(wd.requests),
          workerCpuMs: Math.round(wd.cpuMs),
          doRequests: Math.round(doRequests),
          doWsMsgs: Math.round(doDuration.wsInbound || 0),
          doGbSeconds: Math.round(((doDuration.activeTime || 0) / 1_000_000) * (128 / 1024)),
          doStorageReadUnits: doDuration.storageReadUnits || 0,
          doStorageWriteUnits: doDuration.storageWriteUnits || 0,
          doStorageDeletes: doDuration.storageDeletes || 0,
          doSqlRowsRead: doDuration.rowsRead || 0,
          doSqlRowsWritten: doDuration.rowsWritten || 0,
          doSqlStorageGb: (doSqlStorageBytes / 1_000_000_000) * prorata,
          containerVcpuSec: c.cpuTimeSec || 0,
          containerMemGibSec: (c.allocatedMemory || 0) / (1024 * 1024 * 1024),
          containerDiskGbSec: (c.allocatedDisk || 0) / 1_000_000_000,
          containerEgressGb: (c.txBytes || 0) / 1_000_000_000,
          d1RowsRead,
          d1RowsWritten,
          d1StorageGb: (d1StorageBytes / 1_000_000_000) * prorata,
          kvReads,
          kvWrites,
          kvStorageGb: (kvStorageBytes / 1_000_000_000) * prorata,
        }
      };
    });
  }

  priceResults(appResults: any[]) {
    let grossFleetTotal = 0;

    for (const app of appResults) {
      const costs: any = {};
      for (const key of METRIC_KEYS) costs[key] = app.usage[key] * PRICING[key].rate;
      app.grossCosts = costs;
      app.grossTotal = Object.values(costs).reduce((a: any, b: any) => a + b, 0);
      app.workersCost = app.grossCosts.workerRequests + app.grossCosts.workerCpuMs;
      app.doCost = app.grossCosts.doRequests + app.grossCosts.doGbSeconds + app.grossCosts.doStorageReadUnits + app.grossCosts.doStorageWriteUnits + app.grossCosts.doStorageDeletes + app.grossCosts.doSqlRowsRead + app.grossCosts.doSqlRowsWritten + app.grossCosts.doSqlStorageGb;
      app.containerCost = app.grossCosts.containerVcpuSec + app.grossCosts.containerMemGibSec + app.grossCosts.containerDiskGbSec + app.grossCosts.containerEgressGb;
      app.d1Cost = app.grossCosts.d1RowsRead + app.grossCosts.d1RowsWritten + app.grossCosts.d1StorageGb;
      app.kvCost = app.grossCosts.kvReads + app.grossCosts.kvWrites + app.grossCosts.kvStorageGb;
      grossFleetTotal += app.grossTotal;
    }

    return { appResults, grossFleetTotal };
  }

  applyFreeTier(appResults: any[]) {
    const totals: any = {};
    for (const key of METRIC_KEYS) totals[key] = 0;
    for (const app of appResults) {
      for (const key of METRIC_KEYS) totals[key] += app.usage[key];
    }

    const fleetOverage: any = {};
    for (const key of METRIC_KEYS) {
      const included = PRICING[key].included;
      const overageUsage = Math.max(0, totals[key] - included);
      fleetOverage[key] = overageUsage * PRICING[key].rate;
    }

    const priced = this.priceResults(appResults);
    const grossFleetTotal = priced.grossFleetTotal;

    const netFleetTotal = Object.values(fleetOverage).reduce((a: any, b: any) => a + b, 0) as number;
    const freeTierDiscount = grossFleetTotal - netFleetTotal;

    for (const app of appResults) {
      app.freeTierDiscount = grossFleetTotal > 0 ? freeTierDiscount * (app.grossTotal / grossFleetTotal) : 0;
      app.netTotal = Math.max(0, app.grossTotal - app.freeTierDiscount);
    }

    return { appResults, freeTierDiscount, netFleetTotal, grossFleetTotal };
  }
}
