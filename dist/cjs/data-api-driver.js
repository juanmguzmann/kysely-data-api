"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataApiDriver = void 0;
class DataApiDriver {
    #config;
    constructor(config) {
        this.#config = config;
    }
    async init() {
        // do nothing
    }
    async acquireConnection() {
        return new DataApiConnection(this.#config);
    }
    async beginTransaction(conn) {
        await conn.beginTransaction();
    }
    async commitTransaction(conn) {
        await conn.commitTransaction();
    }
    async rollbackTransaction(conn) {
        await conn.rollbackTransaction();
    }
    async releaseConnection(_connection) {
        // do nothing
    }
    async destroy() {
        // do nothing
    }
}
exports.DataApiDriver = DataApiDriver;
class DataApiConnection {
    #config;
    #transactionId;
    constructor(config) {
        this.#config = config;
    }
    async beginTransaction() {
        const r = await this.#config.client.beginTransaction({
            secretArn: this.#config.secretArn,
            resourceArn: this.#config.resourceArn,
            database: this.#config.database,
        });
        this.#transactionId = r.transactionId;
    }
    async commitTransaction() {
        if (!this.#transactionId)
            throw new Error("Cannot commit a transaction before creating it");
        await this.#config.client.commitTransaction({
            secretArn: this.#config.secretArn,
            resourceArn: this.#config.resourceArn,
            transactionId: this.#transactionId,
        });
    }
    async rollbackTransaction() {
        if (!this.#transactionId)
            throw new Error("Cannot rollback a transaction before creating it");
        await this.#config.client.rollbackTransaction({
            secretArn: this.#config.secretArn,
            resourceArn: this.#config.resourceArn,
            transactionId: this.#transactionId,
        });
    }
    async executeQuery(compiledQuery) {
        const r = await this.#config.client.executeStatement({
            transactionId: this.#transactionId,
            secretArn: this.#config.secretArn,
            resourceArn: this.#config.resourceArn,
            sql: compiledQuery.sql,
            parameters: compiledQuery.parameters,
            database: this.#config.database,
            includeResultMetadata: true,
        });
        if (!r.columnMetadata) {
            const numAffectedRows = BigInt(r.numberOfRecordsUpdated || 0);
            return {
                // @ts-ignore replaces `QueryResult.numUpdatedOrDeletedRows` in kysely >= 0.23
                // following https://github.com/koskimas/kysely/pull/188
                numAffectedRows,
                // deprecated in kysely >= 0.23, keep for backward compatibility.
                numUpdatedOrDeletedRows: numAffectedRows,
                insertId: r.generatedFields && r.generatedFields.length > 0
                    ? BigInt(r.generatedFields[0].longValue)
                    : undefined,
                rows: [],
            };
        }
        const rows = r.records
            ?.filter((r) => r.length !== 0)
            .map((rec) => Object.fromEntries(rec.map((val, i) => {
            const { label, name, typeName } = r.columnMetadata[i];
            const key = label || name;
            let value = val.isNull
                ? null
                : val.stringValue ??
                    val.doubleValue ??
                    val.longValue ??
                    val.booleanValue ??
                    this.#unmarshallArrayValue(val.arrayValue) ??
                    val.blobValue ??
                    null; // FIXME: should throw an error here?
            if (typeof value === "string" && typeName) {
                const typeNameSafe = typeName.toLocaleLowerCase();
                if (typeNameSafe === "timestamp") {
                    value = new Date(value);
                }
                else if (typeNameSafe === "timestamptz") {
                    value = new Date(`${value}Z`);
                }
                else if (["json", "jsonb"].includes(typeNameSafe)) {
                    value = JSON.parse(value);
                }
            }
            return [key, value];
        })));
        return { rows: rows ?? [] };
    }
    async *streamQuery(_compiledQuery, _chunkSize) {
        throw new Error("Data API does not support streaming");
    }
    #unmarshallArrayValue(arrayValue) {
        if (!arrayValue) {
            return undefined;
        }
        return (arrayValue.stringValues ??
            arrayValue.doubleValues ??
            arrayValue.longValues ??
            arrayValue.booleanValues ??
            arrayValue.arrayValues?.map(this.#unmarshallArrayValue));
    }
}
