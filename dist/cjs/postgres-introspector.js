"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresIntrospector = void 0;
const kysely_1 = require("kysely");
const kysely_2 = require("kysely");
class PostgresIntrospector {
    #db;
    constructor(db) {
        this.#db = db;
    }
    async getSchemas() {
        let rawSchemas = await this.#db
            .selectFrom("pg_catalog.pg_namespace")
            .select("nspname")
            .$castTo()
            .execute();
        return rawSchemas.map((it) => ({ name: it.nspname }));
    }
    async getTables(options = { withInternalKyselyTables: false }) {
        let query = this.#db
            // column
            .selectFrom("pg_catalog.pg_attribute as a")
            // table
            .innerJoin("pg_catalog.pg_class as c", "a.attrelid", "c.oid")
            // table schema
            .innerJoin("pg_catalog.pg_namespace as ns", "c.relnamespace", "ns.oid")
            // column data type
            .innerJoin("pg_catalog.pg_type as typ", "a.atttypid", "typ.oid")
            // column data type schema
            .innerJoin("pg_catalog.pg_namespace as dtns", "typ.typnamespace", "dtns.oid")
            .select([
            "a.attname as column",
            "a.attnotnull as not_null",
            "a.atthasdef as has_default",
            "c.relname as table",
            (0, kysely_2.sql) `case when c.relkind = 'v' then true else false end`.as("is_view"),
            "ns.nspname as schema",
            "typ.typname as type",
            "dtns.nspname as type_schema",
            // Detect if the column is auto incrementing by finding the sequence
            // that is created for `serial` and `bigserial` columns.
            this.#db
                .selectFrom("pg_class")
                .select((0, kysely_2.sql) `true`.as("auto_incrementing"))
                // Make sure the sequence is in the same schema as the table.
                .whereRef("relnamespace", "=", "c.relnamespace")
                .where("relkind", "=", "S")
                .where("relname", "=", (0, kysely_2.sql) `c.relname || '_' || a.attname || '_seq'`)
                .as("auto_incrementing"),
        ])
            // r == normal table
            .where("c.relkind", "in", ["r", "v"])
            .where("ns.nspname", "!~", "^pg_")
            .where("ns.nspname", "!=", "information_schema")
            // No system columns
            .where("a.attnum", ">=", 0)
            .where("a.attisdropped", "!=", true)
            .orderBy("ns.nspname")
            .orderBy("c.relname")
            .orderBy("a.attnum")
            .$castTo();
        if (!options.withInternalKyselyTables) {
            query = query
                .where("c.relname", "!=", kysely_1.DEFAULT_MIGRATION_TABLE)
                .where("c.relname", "!=", kysely_1.DEFAULT_MIGRATION_LOCK_TABLE);
        }
        const rawColumns = await query.execute();
        return this.#parseTableMetadata(rawColumns);
    }
    async getMetadata(options) {
        return {
            tables: await this.getTables(options),
        };
    }
    #parseTableMetadata(columns) {
        return columns.reduce((tables, it) => {
            let table = tables.find((tbl) => tbl.name === it.table && tbl.schema === it.schema);
            if (!table) {
                table = Object.freeze({
                    name: it.table,
                    isView: it.is_view,
                    schema: it.schema,
                    columns: [],
                });
                tables.push(table);
            }
            table.columns.push(Object.freeze({
                name: it.column,
                dataType: it.type,
                dataTypeSchema: it.type_schema,
                isNullable: !it.not_null,
                isAutoIncrementing: !!it.auto_incrementing,
                hasDefaultValue: it.has_default,
            }));
            return tables;
        }, []);
    }
}
exports.PostgresIntrospector = PostgresIntrospector;
