import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';

import {
  flat_model_list,
  ml_model_list,
  month_list,
  storey_range_list,
  town_list
} from './lists';

type AppEnv = {
  Bindings: Env;
};

type Month = (typeof month_list)[number];

type PriceQueryRow = {
  intercept_map: number;
  month_map: number;
  storey_range_map: number;
  floor_area_sqm_map: number;
  lease_commence_date_map: number;
  month_name: Month;
  month_multiplier: number;
  town_map: number;
  flat_model_map: number;
  storey_range_multiplier: number;
};

const monthIndexMap = month_list.reduce<Record<Month, number>>((accumulator, month, index) => {
  accumulator[month] = index;
  return accumulator;
}, {} as Record<Month, number>);
const currentYear = new Date().getUTCFullYear();

const pricesFormSchema = z
  .object({
    model: z.enum(ml_model_list),
    town: z.enum(town_list),
    storeyRange: z.enum(storey_range_list),
    flatModel: z.enum(flat_model_list),
    floorAreaSqm: z.coerce
      .number()
      .refine(Number.isFinite, 'Must be a finite number')
      .positive('Must be greater than 0'),
    leaseCommenceYear: z.coerce
      .number()
      .int('Must be an integer')
      .min(1960, 'Must not be before 1960'),
    monthStart: z.enum(month_list),
    monthEnd: z.enum(month_list)
  })
  .strict()
  .superRefine(({ leaseCommenceYear, monthStart, monthEnd }, context) => {
    if (monthIndexMap[monthStart] > monthIndexMap[monthEnd]) {
      context.addIssue({
        code: 'custom',
        path: ['monthEnd'],
        message: 'Must be the same as or after monthStart'
      });
    }

    if (leaseCommenceYear > currentYear) {
      context.addIssue({
        code: 'custom',
        path: ['leaseCommenceYear'],
        message: `Must not be after ${currentYear}`
      });
    }

    if (leaseCommenceYear > Number.parseInt(monthStart.slice(0, 4), 10)) {
      context.addIssue({
        code: 'custom',
        path: ['leaseCommenceYear'],
        message: 'Must not be after the requested prediction period starts'
      });
    }
  });

const app = new Hono<AppEnv>();

app.use('/api/*', cors());

app.post(
  '/api/prices',
  zValidator('form', pricesFormSchema, (result, c) => {
    if (result.success) {
      return;
    }

    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request payload',
          issues: result.error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path.join('.'),
            message: issue.message
          }))
        }
      },
      400
    );
  }),
  async (c) => {
    const formData = c.req.valid('form');

    const { results } = await c.env.DB
      .prepare(
        `SELECT
          ml_models.intercept_map,
          ml_models.month_map,
          ml_models.storey_range_map,
          ml_models.floor_area_sqm_map,
          ml_models.lease_commence_date_map,
          months_ordinal.name AS month_name,
          months_ordinal.value AS month_multiplier,
          towns_onehot.value AS town_map,
          flat_models_onehot.value AS flat_model_map,
          storey_ranges_ordinal.value AS storey_range_multiplier
        FROM ml_models
        JOIN towns_onehot
          ON ml_models.name = towns_onehot.ml_model
        JOIN flat_models_onehot
          ON ml_models.name = flat_models_onehot.ml_model
        JOIN storey_ranges_ordinal
          ON storey_ranges_ordinal.name = ?6
        JOIN months_ordinal
          ON months_ordinal.name BETWEEN ?4 AND ?5
        WHERE ml_models.name = ?1
          AND towns_onehot.name = ?2
          AND flat_models_onehot.name = ?3
        ORDER BY months_ordinal.value ASC;`
      )
      .bind(
        formData.model,
        formData.town,
        formData.flatModel,
        formData.monthStart,
        formData.monthEnd,
        formData.storeyRange
      )
      .all<PriceQueryRow>();

    const predictions = results.map((row) => {
      const month = String(row.month_name) as Month;
      if (!(month in monthIndexMap)) {
        throw new Error(`Unexpected month value from database: ${row.month_name}`);
      }

      const predictedRaw =
        readNumericField(row.intercept_map, 'intercept_map') +
        readNumericField(row.month_multiplier, 'month_multiplier') *
          readNumericField(row.month_map, 'month_map') +
        readNumericField(row.town_map, 'town_map') +
        readNumericField(row.storey_range_multiplier, 'storey_range_multiplier') *
          readNumericField(row.storey_range_map, 'storey_range_map') +
        formData.floorAreaSqm * readNumericField(row.floor_area_sqm_map, 'floor_area_sqm_map') +
        readNumericField(row.flat_model_map, 'flat_model_map') +
        formData.leaseCommenceYear *
          readNumericField(row.lease_commence_date_map, 'lease_commence_date_map');

      if (!Number.isFinite(predictedRaw)) {
        throw new Error(`Prediction calculation produced non-finite value for month ${month}`);
      }

      return {
        month,
        predictedPrice: roundToTwo(Math.max(0, predictedRaw))
      };
    });

    return c.json({ predictions });
  }
);

app.onError((error, c) => {
  console.error(error);
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected internal error occurred.'
      }
    },
    500
  );
});

app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'Not found'
      }
    },
    404
  );
});

function readNumericField(value: unknown, fieldName: string): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`Database field ${fieldName} is not a finite number`);
  }

  return numericValue;
}

function roundToTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export default app;
