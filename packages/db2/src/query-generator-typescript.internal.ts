import type {
  AddIndexQueryOptions,
  ConstraintType,
  DropSchemaQueryOptions,
  ListSchemasQueryOptions,
  ListTablesQueryOptions,
  RenameTableQueryOptions,
  ShowConstraintsQueryOptions,
  TableOrModel,
  TruncateTableQueryOptions,
} from '@sequelize/core';
import { AbstractQueryGenerator, Op } from '@sequelize/core';
import {
  DROP_SCHEMA_QUERY_SUPPORTABLE_OPTIONS,
  RENAME_TABLE_QUERY_SUPPORTABLE_OPTIONS,
  TRUNCATE_TABLE_QUERY_SUPPORTABLE_OPTIONS,
} from '@sequelize/core/_non-semver-use-at-your-own-risk_/abstract-dialect/query-generator-typescript.js';
import { rejectInvalidOptions } from '@sequelize/core/_non-semver-use-at-your-own-risk_/utils/check.js';
import { joinSQLFragments } from '@sequelize/core/_non-semver-use-at-your-own-risk_/utils/join-sql-fragments.js';
import { EMPTY_SET } from '@sequelize/core/_non-semver-use-at-your-own-risk_/utils/object.js';
import { randomBytes } from 'node:crypto';
import type { Db2Dialect } from './dialect.js';
import { Db2QueryGeneratorInternal } from './query-generator.internal.js';

/**
 * Temporary class to ease the TypeScript migration
 */
export class Db2QueryGeneratorTypeScript extends AbstractQueryGenerator {
  readonly #internals: Db2QueryGeneratorInternal;

  constructor(
    dialect: Db2Dialect,
    internals: Db2QueryGeneratorInternal = new Db2QueryGeneratorInternal(dialect),
  ) {
    super(dialect, internals);

    internals.whereSqlBuilder.setOperatorKeyword(Op.regexp, 'REGEXP_LIKE');
    internals.whereSqlBuilder.setOperatorKeyword(Op.notRegexp, 'NOT REGEXP_LIKE');

    this.#internals = internals;
  }

  dropSchemaQuery(schemaName: string, options?: DropSchemaQueryOptions): string {
    if (options) {
      rejectInvalidOptions(
        'dropSchemaQuery',
        this.dialect,
        DROP_SCHEMA_QUERY_SUPPORTABLE_OPTIONS,
        EMPTY_SET,
        options,
      );
    }

    return `DROP SCHEMA ${this.quoteIdentifier(schemaName)} RESTRICT`;
  }

  listSchemasQuery(options?: ListSchemasQueryOptions) {
    let schemasToSkip = this.#internals.getTechnicalSchemaNames();
    if (options && Array.isArray(options?.skip)) {
      schemasToSkip = [...schemasToSkip, ...options.skip];
    }

    return joinSQLFragments([
      'SELECT SCHEMANAME AS "schema" FROM SYSCAT.SCHEMATA',
      `WHERE SCHEMANAME NOT LIKE 'SYS%' AND SCHEMANAME NOT IN (${schemasToSkip.map(schema => this.escape(schema)).join(', ')})`,
    ]);
  }

  describeTableQuery(tableName: TableOrModel) {
    const table = this.extractTableDetails(tableName);

    return joinSQLFragments([
      'SELECT COLNAME AS "Name",',
      'TABNAME AS "Table",',
      'TABSCHEMA AS "Schema",',
      'TYPENAME AS "Type",',
      'LENGTH AS "Length",',
      'SCALE AS "Scale",',
      'NULLS AS "IsNull",',
      'DEFAULT AS "Default",',
      'COLNO AS "Colno",',
      'IDENTITY AS "IsIdentity",',
      'KEYSEQ AS "KeySeq",',
      'REMARKS AS "Comment"',
      'FROM SYSCAT.COLUMNS',
      `WHERE TABNAME = ${this.escape(table.tableName)}`,
      `AND TABSCHEMA = ${this.escape(table.schema)}`,
    ]);
  }

  listTablesQuery(options?: ListTablesQueryOptions) {
    return joinSQLFragments([
      'SELECT TABNAME AS "tableName",',
      'TRIM(TABSCHEMA) AS "schema"',
      `FROM SYSCAT.TABLES WHERE TYPE = 'T'`,
      options?.schema
        ? `AND TABSCHEMA = ${this.escape(options.schema)}`
        : `AND TABSCHEMA NOT LIKE 'SYS%' AND TABSCHEMA NOT IN (${this.#internals
            .getTechnicalSchemaNames()
            .map(schema => this.escape(schema))
            .join(', ')})`,
      'ORDER BY TABSCHEMA, TABNAME',
    ]);
  }

  renameTableQuery(
    beforeTableName: TableOrModel,
    afterTableName: TableOrModel,
    options?: RenameTableQueryOptions,
  ): string {
    if (options) {
      rejectInvalidOptions(
        'renameTableQuery',
        this.dialect,
        RENAME_TABLE_QUERY_SUPPORTABLE_OPTIONS,
        EMPTY_SET,
        options,
      );
    }

    const beforeTable = this.extractTableDetails(beforeTableName);
    const afterTable = this.extractTableDetails(afterTableName);

    if (beforeTable.schema !== afterTable.schema) {
      throw new Error(
        `Moving tables between schemas is not supported by ${this.dialect.name} dialect.`,
      );
    }

    return `RENAME TABLE ${this.quoteTable(beforeTableName)} TO ${this.quoteIdentifier(afterTable.tableName)}`;
  }

  truncateTableQuery(tableName: TableOrModel, options?: TruncateTableQueryOptions) {
    if (options) {
      rejectInvalidOptions(
        'truncateTableQuery',
        this.dialect,
        TRUNCATE_TABLE_QUERY_SUPPORTABLE_OPTIONS,
        EMPTY_SET,
        options,
      );
    }

    return `TRUNCATE TABLE ${this.quoteTable(tableName)} IMMEDIATE`;
  }

  #getConstraintType(type: ConstraintType): string {
    switch (type) {
      case 'CHECK':
        return 'K';
      case 'FOREIGN KEY':
        return 'F';
      case 'PRIMARY KEY':
        return 'P';
      case 'UNIQUE':
        return 'U';
      default:
        throw new Error(`Constraint type ${type} is not supported`);
    }
  }

  showConstraintsQuery(tableName: TableOrModel, options?: ShowConstraintsQueryOptions) {
    const table = this.extractTableDetails(tableName);

    return joinSQLFragments([
      'SELECT TRIM(c.TABSCHEMA) AS "constraintSchema",',
      'c.CONSTNAME AS "constraintName",',
      `CASE c.TYPE WHEN 'P' THEN 'PRIMARY KEY' WHEN 'F' THEN 'FOREIGN KEY' WHEN 'K' THEN 'CHECK' WHEN 'U' THEN 'UNIQUE' ELSE NULL END AS "constraintType",`,
      'TRIM(c.TABSCHEMA) AS "tableSchema",',
      'c.TABNAME AS "tableName",',
      'k.COLNAME AS "columnNames",',
      'TRIM(r.REFTABSCHEMA) AS "referencedTableSchema",',
      'r.REFTABNAME AS "referencedTableName",',
      'fk.COLNAME AS "referencedColumnNames",',
      `CASE r.DELETERULE WHEN 'A' THEN 'NO ACTION' WHEN 'C' THEN 'CASCADE' WHEN 'N' THEN 'SET NULL' WHEN 'R' THEN 'RESTRICT' ELSE NULL END AS "deleteAction",`,
      `CASE r.UPDATERULE WHEN 'A' THEN 'NO ACTION' WHEN 'R' THEN 'RESTRICT' ELSE NULL END AS "updateAction",`,
      'ck.TEXT AS "definition"',
      'FROM SYSCAT.TABCONST c',
      'LEFT JOIN SYSCAT.REFERENCES r ON c.CONSTNAME = r.CONSTNAME AND c.TABNAME = r.TABNAME AND c.TABSCHEMA = r.TABSCHEMA',
      'LEFT JOIN SYSCAT.KEYCOLUSE k ON c.CONSTNAME = k.CONSTNAME AND c.TABNAME = k.TABNAME AND c.TABSCHEMA = k.TABSCHEMA',
      'LEFT JOIN SYSCAT.KEYCOLUSE fk ON r.REFKEYNAME = fk.CONSTNAME',
      'LEFT JOIN SYSCAT.CHECKS ck ON c.CONSTNAME = ck.CONSTNAME AND c.TABNAME = ck.TABNAME AND c.TABSCHEMA = ck.TABSCHEMA',
      `WHERE c.TABNAME = ${this.escape(table.tableName)}`,
      `AND c.TABSCHEMA = ${this.escape(table.schema)}`,
      options?.columnName ? `AND k.COLNAME = ${this.escape(options.columnName)}` : '',
      options?.constraintName ? `AND c.CONSTNAME = ${this.escape(options.constraintName)}` : '',
      options?.constraintType
        ? `AND c.TYPE = ${this.escape(this.#getConstraintType(options.constraintType))}`
        : '',
      'ORDER BY c.CONSTNAME, k.COLSEQ, fk.COLSEQ',
    ]);
  }

  addIndexQuery(tableOrModel: TableOrModel, options: AddIndexQueryOptions): string {
    if ('include' in options && !options.unique && options.type?.toLowerCase() !== 'unique') {
      throw new Error('DB2 does not support non-unique indexes with INCLUDE syntax.');
    }

    return super.addIndexQuery(tableOrModel, options);
  }

  showIndexesQuery(tableName: TableOrModel) {
    const table = this.extractTableDetails(tableName);

    return joinSQLFragments([
      'SELECT i.TABSCHEMA AS "schema",',
      'i.TABNAME AS "tableName",',
      'i.INDNAME AS "name",',
      'i.UNIQUERULE AS "keyType",',
      'c.COLNAME AS "columnName",',
      'c.COLORDER AS "columnOrder",',
      'c.TEXT AS "expression"',
      'FROM SYSCAT.INDEXES i',
      'INNER JOIN SYSCAT.INDEXCOLUSE c ON i.INDNAME = c.INDNAME AND i.INDSCHEMA = c.INDSCHEMA',
      `WHERE TABNAME = ${this.escape(table.tableName)}`,
      `AND TABSCHEMA = ${this.escape(table.schema)}`,
      'ORDER BY i.INDNAME, c.COLSEQ;',
    ]);
  }

  versionQuery() {
    return 'select service_level as "version" from TABLE (sysproc.env_get_inst_info()) as A';
  }

  tableExistsQuery(tableName: TableOrModel): string {
    const table = this.extractTableDetails(tableName);

    return `SELECT TABNAME FROM SYSCAT.TABLES WHERE TABNAME = ${this.escape(table.tableName)} AND TABSCHEMA = ${this.escape(table.schema)}`;
  }

  createSavepointQuery(savepointName: string): string {
    return `SAVEPOINT ${this.quoteIdentifier(savepointName)} ON ROLLBACK RETAIN CURSORS`;
  }

  generateTransactionId(): string {
    return randomBytes(10).toString('hex');
  }

  getDefaultValueQuery(tableOrModel: TableOrModel, columnName: string) {
    const table = this.extractTableDetails(tableOrModel);

    return joinSQLFragments([
      'SELECT TABNAME AS "tableName",',
      'COLNAME AS "columnName",',
      'DEFAULT AS "defaultValue"',
      'FROM SYSCAT.COLUMNS WHERE DEFAULT IS NOT NULL',
      `AND TABSCHEMA = ${this.escape(table.schema)}`,
      `AND TABNAME = ${this.escape(table.tableName)}`,
      `AND COLNAME = ${this.escape(columnName)}`,
    ]);
  }

  dropDefaultValueQuery(tableOrModel: TableOrModel, columnName: string) {
    return joinSQLFragments([
      'ALTER TABLE',
      this.quoteTable(tableOrModel),
      'ALTER COLUMN',
      this.quoteIdentifier(columnName),
      'DROP DEFAULT;',
    ]);
  }
}
