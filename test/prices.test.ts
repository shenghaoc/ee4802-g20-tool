import { describe, expect, it } from 'vitest';

import app from '../src/index';
import {
  flat_model_list,
  ml_model_list,
  month_list,
  storey_range_list,
  town_list
} from '../src/lists';

type PriceFormData = {
  model: string;
  town: string;
  storeyRange: string;
  flatModel: string;
  floorAreaSqm: string;
  leaseCommenceYear: string;
  monthStart: string;
  monthEnd: string;
};

type PredictionResponse = {
  predictions: Array<{
    month: string;
    predictedPrice: number;
  }>;
};

type ValidationErrorResponse = {
  error: {
    code: string;
    message: string;
    issues?: Array<{
      code: string;
      path: string;
      message: string;
    }>;
  };
};

type QueryRow = {
  intercept_map: number;
  month_map: number;
  storey_range_map: number;
  floor_area_sqm_map: number;
  lease_commence_date_map: number;
  month_name: string;
  month_multiplier: number;
  town_map: number;
  flat_model_map: number;
  storey_range_multiplier: number;
};

const BASE_FORM: PriceFormData = {
  model: ml_model_list[0],
  town: town_list[0],
  storeyRange: storey_range_list[0],
  flatModel: flat_model_list[0],
  floorAreaSqm: '95',
  leaseCommenceYear: '2001',
  monthStart: '2019-01',
  monthEnd: '2019-03'
};

const monthIndexMap = month_list.reduce<Record<string, number>>((accumulator, month, index) => {
  accumulator[month] = index;
  return accumulator;
}, {});
const townValues = [...town_list] as string[];
const storeyRangeValues = [...storey_range_list] as string[];
const flatModelValues = [...flat_model_list] as string[];

class MockPreparedStatement {
  private boundValues: unknown[] = [];

  bind(...values: unknown[]): this {
    this.boundValues = values;
    return this;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const [model, town, flatModel, monthStart, monthEnd, storeyRange] =
      this.boundValues as [string, string, string, string, string, string];

    return {
      results: createRows(model, town, flatModel, monthStart, monthEnd, storeyRange) as T[]
    };
  }
}

class MockD1Database {
  prepareCalls = 0;

  prepare(_query: string): MockPreparedStatement {
    this.prepareCalls += 1;
    return new MockPreparedStatement();
  }
}

function createRows(
  model: string,
  town: string,
  flatModel: string,
  monthStart: string,
  monthEnd: string,
  storeyRange: string
): QueryRow[] {
  const startIndex = monthIndexMap[monthStart];
  const endIndex = monthIndexMap[monthEnd];

  if (startIndex === undefined || endIndex === undefined || startIndex > endIndex) {
    return [];
  }

  const modelIntercept = model === ml_model_list[0] ? 300_000 : 340_000;
  const monthSlope = model === ml_model_list[0] ? 820 : 910;
  const townValue = (townValues.indexOf(town) - 12) * 1_350;
  const storeyValue = Math.max(0, storeyRangeValues.indexOf(storeyRange));
  const flatValue = (flatModelValues.indexOf(flatModel) - 8) * 1_100;

  return month_list.slice(startIndex, endIndex + 1).map((month, index) => ({
    intercept_map: modelIntercept,
    month_map: monthSlope,
    storey_range_map: 12_000,
    floor_area_sqm_map: 4_250,
    lease_commence_date_map: 5_100,
    month_name: month,
    month_multiplier: startIndex + index,
    town_map: townValue,
    flat_model_map: flatValue,
    storey_range_multiplier: storeyValue
  }));
}

function buildRequestPayload(
  overrides: Partial<PriceFormData> = {},
  omitFields: Array<keyof PriceFormData> = []
): FormData {
  const payload: PriceFormData = {
    ...BASE_FORM,
    ...overrides
  };

  const form = new FormData();
  for (const [key, value] of Object.entries(payload) as Array<[keyof PriceFormData, string]>) {
    if (!omitFields.includes(key)) {
      form.append(key, value);
    }
  }

  return form;
}

async function postPrices(
  overrides: Partial<PriceFormData> = {},
  options: { omitFields?: Array<keyof PriceFormData>; db?: MockD1Database } = {}
): Promise<{ response: Response; db: MockD1Database }> {
  const db = options.db ?? new MockD1Database();
  const request = new Request('http://localhost/api/prices', {
    method: 'POST',
    body: buildRequestPayload(overrides, options.omitFields)
  });

  const response = await app.fetch(
    request,
    { DB: db as unknown as D1Database },
    {
      waitUntil() {
        return undefined;
      },
      passThroughOnException() {
        return undefined;
      },
      props: {}
    } as ExecutionContext
  );

  return {
    response,
    db
  };
}

function buildPairwiseEnumCases(): Array<{
  model: string;
  town: string;
  storeyRange: string;
  flatModel: string;
}> {
  const dimensions = [
    [...ml_model_list],
    [...town_list],
    [...storey_range_list],
    [...flat_model_list]
  ] as const;

  const candidates: Array<[string, string, string, string]> = [];
  for (const model of dimensions[0]) {
    for (const town of dimensions[1]) {
      for (const storeyRange of dimensions[2]) {
        for (const flatModel of dimensions[3]) {
          candidates.push([model, town, storeyRange, flatModel]);
        }
      }
    }
  }

  const uncoveredPairs = new Set<string>();
  for (let leftDimension = 0; leftDimension < dimensions.length; leftDimension += 1) {
    for (let rightDimension = leftDimension + 1; rightDimension < dimensions.length; rightDimension += 1) {
      for (const leftValue of dimensions[leftDimension]) {
        for (const rightValue of dimensions[rightDimension]) {
          uncoveredPairs.add(`${leftDimension}:${leftValue}|${rightDimension}:${rightValue}`);
        }
      }
    }
  }

  const selected: Array<[string, string, string, string]> = [];

  while (uncoveredPairs.size > 0) {
    let bestCandidateIndex = -1;
    let bestCoveredPairs: string[] = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const coveredPairs: string[] = [];

      for (let leftDimension = 0; leftDimension < candidate.length; leftDimension += 1) {
        for (
          let rightDimension = leftDimension + 1;
          rightDimension < candidate.length;
          rightDimension += 1
        ) {
          const pairKey =
            `${leftDimension}:${candidate[leftDimension]}|` +
            `${rightDimension}:${candidate[rightDimension]}`;
          if (uncoveredPairs.has(pairKey)) {
            coveredPairs.push(pairKey);
          }
        }
      }

      if (coveredPairs.length > bestCoveredPairs.length) {
        bestCandidateIndex = index;
        bestCoveredPairs = coveredPairs;

        if (coveredPairs.length === 6) {
          break;
        }
      }
    }

    if (bestCandidateIndex < 0 || bestCoveredPairs.length === 0) {
      break;
    }

    const [selectedCandidate] = candidates.splice(bestCandidateIndex, 1);
    selected.push(selectedCandidate);

    for (const pairKey of bestCoveredPairs) {
      uncoveredPairs.delete(pairKey);
    }
  }

  if (uncoveredPairs.size > 0) {
    throw new Error(`Unable to cover all enum pairs. Remaining pairs: ${uncoveredPairs.size}`);
  }

  return selected.map(([model, town, storeyRange, flatModel]) => ({
    model,
    town,
    storeyRange,
    flatModel
  }));
}

describe('POST /api/prices validation', () => {
  it('accepts a valid payload', async () => {
    const { response } = await postPrices();
    const body = (await response.json()) as PredictionResponse;

    expect(response.status).toBe(200);
    expect(Array.isArray(body.predictions)).toBe(true);
    expect(body.predictions.length).toBeGreaterThan(0);
  });

  it('rejects payload with missing fields', async () => {
    const { response } = await postPrices({}, { omitFields: ['town'] });
    const body = (await response.json()) as ValidationErrorResponse;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.issues?.some((issue) => issue.path === 'town')).toBe(true);
  });

  it('rejects payload with invalid enum values', async () => {
    const { response } = await postPrices({ model: 'Unknown Model' });
    const body = (await response.json()) as ValidationErrorResponse;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.issues?.some((issue) => issue.path === 'model')).toBe(true);
  });

  it('rejects payload when monthStart is after monthEnd', async () => {
    const db = new MockD1Database();
    const { response } = await postPrices(
      {
        monthStart: '2020-03',
        monthEnd: '2020-01'
      },
      { db }
    );
    const body = (await response.json()) as ValidationErrorResponse;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.issues?.some((issue) => issue.path === 'monthEnd')).toBe(true);
    expect(db.prepareCalls).toBe(0);
  });

  it('rejects out-of-dataset months', async () => {
    const { response } = await postPrices({ monthEnd: '2022-03' });
    const body = (await response.json()) as ValidationErrorResponse;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.issues?.some((issue) => issue.path === 'monthEnd')).toBe(true);
  });

  it('accepts boundary values for floorAreaSqm and leaseCommenceYear', async () => {
    const { response } = await postPrices({
      floorAreaSqm: '0.01',
      leaseCommenceYear: '1960',
      monthStart: '2017-01',
      monthEnd: '2017-01'
    });

    expect(response.status).toBe(200);
  });

  it('rejects non-positive floorAreaSqm', async () => {
    const { response } = await postPrices({ floorAreaSqm: '0' });
    const body = (await response.json()) as ValidationErrorResponse;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.issues?.some((issue) => issue.path === 'floorAreaSqm')).toBe(true);
  });
});

describe('POST /api/prices enum and matrix coverage', () => {
  it.each([...ml_model_list])('accepts model: %s', async (model) => {
    const { response } = await postPrices({ model });
    expect(response.status).toBe(200);
  });

  it.each([...town_list])('accepts town: %s', async (town) => {
    const { response } = await postPrices({ town });
    expect(response.status).toBe(200);
  });

  it.each([...storey_range_list])('accepts storeyRange: %s', async (storeyRange) => {
    const { response } = await postPrices({ storeyRange });
    expect(response.status).toBe(200);
  });

  it.each([...flat_model_list])('accepts flatModel: %s', async (flatModel) => {
    const { response } = await postPrices({ flatModel });
    expect(response.status).toBe(200);
  });

  it('accepts pairwise combination samples across model/town/storeyRange/flatModel', async () => {
    const samples = buildPairwiseEnumCases();

    for (const [index, sample] of samples.entries()) {
      const { response } = await postPrices(sample);
      expect(response.status, `Pairwise sample #${index + 1} failed`).toBe(200);
    }
  });
});

describe('POST /api/prices range and regression behavior', () => {
  it('returns a single prediction for a single-month range', async () => {
    const { response } = await postPrices({
      monthStart: '2020-05',
      monthEnd: '2020-05'
    });
    const body = (await response.json()) as PredictionResponse;

    expect(response.status).toBe(200);
    expect(body.predictions).toHaveLength(1);
    expect(body.predictions[0]?.month).toBe('2020-05');
  });

  it('returns sorted predictions for multi-month ranges within bounds', async () => {
    const { response } = await postPrices({
      monthStart: '2018-11',
      monthEnd: '2019-02'
    });
    const body = (await response.json()) as PredictionResponse;

    expect(response.status).toBe(200);
    expect(body.predictions).toHaveLength(4);

    const months = body.predictions.map((prediction) => prediction.month);
    expect(months).toEqual(['2018-11', '2018-12', '2019-01', '2019-02']);
  });

  it('always returns the response shape { predictions: [{ month, predictedPrice }] }', async () => {
    const { response } = await postPrices();
    const body = (await response.json()) as PredictionResponse;

    expect(response.status).toBe(200);
    expect(Object.keys(body)).toEqual(['predictions']);
    expect(body.predictions.length).toBeGreaterThan(0);
    expect(Object.keys(body.predictions[0] ?? {}).sort()).toEqual(['month', 'predictedPrice']);
  });

  it('returns only finite numeric predictedPrice values', async () => {
    const { response } = await postPrices({
      monthStart: '2017-01',
      monthEnd: '2022-02'
    });
    const body = (await response.json()) as PredictionResponse;

    expect(response.status).toBe(200);
    expect(body.predictions.length).toBe(month_list.length);

    for (const prediction of body.predictions) {
      expect(Number.isFinite(prediction.predictedPrice)).toBe(true);
      expect(prediction.predictedPrice).toBeGreaterThanOrEqual(0);
    }
  });
});
