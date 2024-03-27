'use strict';

import { DataTypes } from '@sequelize/core';
import {
  attributeTypeToSql,
  normalizeDataType,
} from '@sequelize/core/_non-semver-use-at-your-own-risk_/abstract-dialect/data-types-utils.js';
import {
  ADD_COLUMN_QUERY_SUPPORTABLE_OPTIONS,
  CREATE_TABLE_QUERY_SUPPORTABLE_OPTIONS,
} from '@sequelize/core/_non-semver-use-at-your-own-risk_/abstract-dialect/query-generator.js';
import { rejectInvalidOptions } from '@sequelize/core/_non-semver-use-at-your-own-risk_/utils/check.js';
import { EMPTY_SET } from '@sequelize/core/_non-semver-use-at-your-own-risk_/utils/object.js';
import { defaultValueSchemable } from '@sequelize/core/_non-semver-use-at-your-own-risk_/utils/query-builder-utils.js';
import { removeTrailingSemicolon } from '@sequelize/core/_non-semver-use-at-your-own-risk_/utils/string.js';
import each from 'lodash/each';
import isPlainObject from 'lodash/isPlainObject';
import { IBMiQueryGeneratorTypeScript } from './query-generator-typescript.internal.js';

const typeWithoutDefault = new Set(['BLOB']);

const CREATE_TABLE_QUERY_SUPPORTED_OPTIONS = new Set(['uniqueKeys']);

export class IBMiQueryGenerator extends IBMiQueryGeneratorTypeScript {
  // Table queries
  createTableQuery(tableName, attributes, options) {
    if (options) {
      rejectInvalidOptions(
        'createTableQuery',
        this.dialect,
        CREATE_TABLE_QUERY_SUPPORTABLE_OPTIONS,
        CREATE_TABLE_QUERY_SUPPORTED_OPTIONS,
        options,
      );
    }

    const primaryKeys = [];
    const foreignKeys = Object.create(null);
    const attrStr = [];

    for (const attr in attributes) {
      if (!Object.hasOwn(attributes, attr)) {
        continue;
      }

      const dataType = attributes[attr];

      if (dataType.includes('PRIMARY KEY')) {
        primaryKeys.push(attr);
        attrStr.push(`${this.quoteIdentifier(attr)} ${dataType.replace('PRIMARY KEY', '')}`);
      } else {
        attrStr.push(`${this.quoteIdentifier(attr)} ${dataType}`);
      }
    }

    let attributesClause = attrStr.join(', ');
    const pkString = primaryKeys.map(pk => this.quoteIdentifier(pk)).join(', ');

    if (options?.uniqueKeys) {
      // only need to sort primary keys once, don't do it in place
      const sortedPrimaryKeys = [...primaryKeys];
      sortedPrimaryKeys.sort();

      each(options.uniqueKeys, (columns, indexName) => {
        // sort the columns for each unique key, so they can be easily compared
        // with the sorted primary key fields
        const sortedColumnFields = [...columns.fields];
        sortedColumnFields.sort();
        // if primary keys === unique keys, then skip adding new constraint
        const uniqueIsPrimary =
          sortedColumnFields.length === primaryKeys.length &&
          sortedColumnFields.every((value, index) => {
            return value === sortedPrimaryKeys[index];
          });
        if (uniqueIsPrimary) {
          return true;
        }

        if (typeof indexName !== 'string') {
          indexName = `uniq_${tableName}_${columns.fields.join('_')}`;
        }

        attributesClause += `, CONSTRAINT ${this.quoteIdentifier(indexName)} UNIQUE (${columns.fields.map(field => this.quoteIdentifier(field)).join(', ')})`;
      });
    }

    if (pkString.length > 0) {
      attributesClause += `, PRIMARY KEY (${pkString})`;
    }

    for (const fkey in foreignKeys) {
      if (Object.hasOwn(foreignKeys, fkey)) {
        attributesClause += `, FOREIGN KEY (${this.quoteIdentifier(fkey)}) ${foreignKeys[fkey]}`;
      }
    }

    const quotedTable = this.quoteTable(tableName);

    return `BEGIN
    DECLARE CONTINUE HANDLER FOR SQLSTATE VALUE '42710'
      BEGIN END;
      CREATE TABLE ${quotedTable} (${attributesClause});
      END`;
  }

  addColumnQuery(table, key, dataType, options) {
    if (options) {
      rejectInvalidOptions(
        'addColumnQuery',
        this.dialect,
        ADD_COLUMN_QUERY_SUPPORTABLE_OPTIONS,
        EMPTY_SET,
        options,
      );
    }

    dataType = {
      ...dataType,
      // TODO: attributeToSQL SHOULD be using attributes in addColumnQuery
      //       but instead we need to pass the key along as the field here
      field: key,
      type: normalizeDataType(dataType.type, this.dialect),
    };

    const definition = this.attributeToSQL(dataType, {
      context: 'addColumn',
      tableName: table,
      foreignKey: key,
    });

    return `ALTER TABLE ${this.quoteTable(table)} ADD ${this.quoteIdentifier(key)} ${definition}`;
  }

  changeColumnQuery(tableName, attributes) {
    const attrString = [];
    const constraintString = [];

    for (const attributeName in attributes) {
      let definition = attributes[attributeName];
      if (definition.includes('REFERENCES')) {
        const attrName = this.quoteIdentifier(attributeName);
        definition = definition.replace(/.+?(?=REFERENCES)/, '');
        const foreignKey = this.quoteIdentifier(`${attributeName}`);
        constraintString.push(`${foreignKey} FOREIGN KEY (${attrName}) ${definition}`);
      } else {
        attrString.push(`"${attributeName}" SET DATA TYPE ${definition}`);
      }
    }

    let finalQuery = '';
    if (attrString.length) {
      finalQuery += `ALTER COLUMN ${attrString.join(', ')}`;
      finalQuery += constraintString.length ? ' ' : '';
    }

    if (constraintString.length) {
      finalQuery += `ADD CONSTRAINT ${constraintString.join(', ')}`;
    }

    return `ALTER TABLE ${this.quoteTable(tableName)} ${finalQuery}`;
  }

  renameColumnQuery(tableName, attrBefore, attributes) {
    const attrString = [];

    for (const attrName in attributes) {
      const definition = attributes[attrName];
      attrString.push(`\`${attrBefore}\` \`${attrName}\` ${definition}`);
    }

    return `ALTER TABLE ${this.quoteTable(tableName)} RENAME COLUMN ${attrString.join(', ')};`;
  }

  updateQuery(tableName, attrValueHash, where, options, columnDefinitions) {
    const out = super.updateQuery(tableName, attrValueHash, where, options, columnDefinitions);

    out.query = removeTrailingSemicolon(out.query);

    return out;
  }

  arithmeticQuery(
    operator,
    tableName,
    where,
    incrementAmountsByField,
    extraAttributesToBeUpdated,
    options,
  ) {
    return removeTrailingSemicolon(
      super.arithmeticQuery(
        operator,
        tableName,
        where,
        incrementAmountsByField,
        extraAttributesToBeUpdated,
        options,
      ),
    );
  }

  insertQuery(table, valueHash, modelAttributes, options) {
    // remove the final semi-colon
    const query = super.insertQuery(table, valueHash, modelAttributes, options);
    if (query.query.at(-1) === ';') {
      query.query = query.query.slice(0, -1);
      query.query = `SELECT * FROM FINAL TABLE (${query.query})`;
    }

    return query;
  }

  selectQuery(tableName, options, model) {
    // remove the final semi-colon
    let query = super.selectQuery(tableName, options, model);
    if (query.at(-1) === ';') {
      query = query.slice(0, -1);
    }

    return query;
  }

  bulkInsertQuery(tableName, fieldValueHashes, options, fieldMappedAttributes) {
    // remove the final semi-colon
    let query = super.bulkInsertQuery(tableName, fieldValueHashes, options, fieldMappedAttributes);
    if (query.at(-1) === ';') {
      query = query.slice(0, -1);
      query = `SELECT * FROM FINAL TABLE (${query})`;
    }

    return query;
  }

  // bindParam(bind) {
  //   return value => {
  //     bind.push(value);

  //     return '?';
  //   };
  // }

  attributeToSQL(attribute, options) {
    if (!isPlainObject(attribute)) {
      attribute = {
        type: attribute,
      };
    }

    const attributeString = attribute.type.toString({
      escape: this.escape.bind(this),
      dialect: this.dialect,
    });
    let template = attributeString;

    if (attribute.type instanceof DataTypes.ENUM) {
      // enums are a special case
      template = attribute.type.toSql({ dialect: this.dialect });
      if (options && options.context) {
        template += options.context === 'changeColumn' ? ' ADD' : '';
      }

      template += ` CHECK (${this.quoteIdentifier(attribute.field)} IN(${attribute.type.options.values
        .map(value => {
          return this.escape(value);
        })
        .join(', ')}))`;
    } else {
      template = attributeTypeToSql(attribute.type, { dialect: this.dialect });
    }

    if (attribute.allowNull === false) {
      template += ' NOT NULL';
    } else if (attribute.allowNull === true && options && options.context === 'changeColumn') {
      template += ' DROP NOT NULL';
    }

    if (attribute.autoIncrement) {
      template += ' GENERATED BY DEFAULT AS IDENTITY (START WITH 1, INCREMENT BY 1)';
    }

    // BLOB cannot have a default value
    if (
      !typeWithoutDefault.has(attributeString) &&
      attribute.type._binary !== true &&
      defaultValueSchemable(attribute.defaultValue, this.dialect)
    ) {
      if (attribute.defaultValue === true) {
        attribute.defaultValue = 1;
      } else if (attribute.defaultValue === false) {
        attribute.defaultValue = 0;
      }

      template += ` DEFAULT ${this.escape(attribute.defaultValue)}`;
    }

    if (attribute.unique === true && !attribute.primaryKey) {
      template += ' UNIQUE';
    }

    if (attribute.primaryKey) {
      template += ' PRIMARY KEY';
    }

    // Db2 for i comments are a mess
    // if (attribute.comment) {
    //   template += ` ${options.context === 'changeColumn' ? 'ADD ' : ''}COMMENT ${this.escape(attribute.comment)}`;
    // }

    if (attribute.first) {
      template += ' FIRST';
    }

    if (attribute.after) {
      template += ` AFTER ${this.quoteIdentifier(attribute.after)}`;
    }

    if (attribute.references) {
      if (options && options.context === 'addColumn' && options.foreignKey) {
        const attrName = this.quoteIdentifier(options.foreignKey);
        const fkName = this.quoteIdentifier(`${options.tableName}_${attrName}_foreign_idx`);

        template += ` ADD CONSTRAINT ${fkName} FOREIGN KEY (${attrName})`;
      }

      template += ` REFERENCES ${this.quoteTable(attribute.references.table)}`;

      if (attribute.references.key) {
        template += ` (${this.quoteIdentifier(attribute.references.key)})`;
      } else {
        template += ` (${this.quoteIdentifier('id')})`;
      }

      if (attribute.onDelete) {
        template += ` ON DELETE ${attribute.onDelete.toUpperCase()}`;
      }

      if (attribute.onUpdate && attribute.onUpdate.toUpperCase() !== 'CASCADE') {
        template += ` ON UPDATE ${attribute.onUpdate.toUpperCase()}`;
      }
    }

    return template;
  }

  attributesToSQL(attributes, options) {
    const result = Object.create(null);

    for (const key of Object.keys(attributes)) {
      const attribute = {
        ...attributes[key],
        field: attributes[key].field || key,
      };

      result[attribute.field || key] = this.attributeToSQL(attribute, options);
    }

    return result;
  }
}
