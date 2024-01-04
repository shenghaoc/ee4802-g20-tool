import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();
app.use('/api/*', cors());

app.get('/api/prices', async c => {
  const { ml_model, month_start, month_end, town, storey_range, flat_model, floor_area_sqm, lease_commence_date } = c.req.query();

  if (!ml_model) return c.text('Missing ML Model');
  if (!month_start) return c.text('Missing Start Month');
  if (!month_end) return c.text('Missing End Month');
  if (!town) return c.text('Missing Town');
  if (!storey_range) return c.text('Missing Storey Range');
  if (!flat_model) return c.text('Missing Flat Model');
  if (!floor_area_sqm) return c.text('Missing Floor Area');
  if (!lease_commence_date) return c.text('Missing Lease Commence Date');

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
    .bind(ml_model, town, flat_model, month_start, month_end, storey_range)
    .all();

  return c.json(results.map(x => ({
    labels: x["month_name"], data: (Math.round(Math.max(0, (x["intercept_map"]
      + x["month_multiplier"] * x["month_map"]
      + x["town_map"]
      + x["storey_range_multiplier"] * x["storey_range_map"]
      + floor_area_sqm * x["floor_area_sqm_map"]
      + x["flat_model_map"]
      + lease_commence_date * x["lease_commence_date_map"])) * 100) / 100
    )
  })));
});

app.onError((err, c) => {
  console.error(`${err}`);
  return c.text(err.toString());
});

app.notFound(c => c.text('Not found', 404));

export default app;
