import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

import { ml_model_list } from './lists';
import { town_list } from './lists';
import { storey_range_list } from './lists';
import { flat_model_list } from './lists';

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();
app.use('/api/*', cors());

app.post(
  '/api/prices',
  zValidator(
    'form',
    z.object({
      ml_model: z.enum(ml_model_list),
      town: z.enum(town_list),
      storey_range: z.enum(storey_range_list),
      flat_model: z.enum(flat_model_list,),
      floor_area_sqm: z.string().transform((val) => parseFloat(val))
        .pipe(z.number().min(0, 'Must be greater than 0')),
      lease_commence_date: z.string().transform((val) => new Date(val))
        .pipe(z.date().min(new Date('1960-01-01'), { message: 'Must not be before 1960' })
          .max(new Date('2022-02-01'), { message: 'Must not be in future' }))
    })
  ),
  async (c) => {
    let formData: FormData;
    await c.req.parseBody().then(result => {
      formData = result;
    });

    const { results } = await c.env.DB.prepare("SELECT intercept_map, month_map, \
  storey_range_map, floor_area_sqm_map, lease_commence_date_map, \
  months_ordinal.name \
  AS month_name, \
  months_ordinal.value \
  AS month_multiplier, \
  towns_onehot.value \
  AS town_map, \
  flat_models_onehot.value \
  AS flat_model_map, \
  storey_ranges_ordinal.value \
  AS  storey_range_multiplier \
  FROM ((ml_models \
  JOIN towns_onehot \
  ON ml_models.name=towns_onehot.ml_model) \
  JOIN flat_models_onehot \
  ON ml_models.name=flat_models_onehot.ml_model) \
  JOIN months_ordinal \
  JOIN storey_ranges_ordinal \
  WHERE ml_models.name=?1 \
  AND towns_onehot.name=?2 \
  AND flat_models_onehot.name=?3 \
  AND months_ordinal.name \
  BETWEEN ?4 \
  AND ?5 \
  AND storey_ranges_ordinal.name=?6;")
      .bind(formData.ml_model, formData.town, formData.flat_model, formData.month_start, formData.month_end, formData.storey_range)
      .all();

    return c.json(results.map(x => ({
      labels: x["month_name"], data: (Math.round(Math.max(0, (x["intercept_map"]
        + x["month_multiplier"] * x["month_map"]
        + x["town_map"]
        + x["storey_range_multiplier"] * x["storey_range_map"]
        + formData.floor_area_sqm * x["floor_area_sqm_map"]
        + x["flat_model_map"]
        + formData.lease_commence_date * x["lease_commence_date_map"])) * 100) / 100
      )
    })));
  });

app.onError((err, c) => {
  console.error(`${err}`);
  return c.text(err.toString());
});

app.notFound(c => c.text('Not found', 404));

export default app;
