import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();
app.use('/api/*', cors());

app.get('/api/prices', async c => {
  const { ml_model, town, storey_range, flat_model, floor_area_sqm, lease_commence_date } = c.req.query();

  if (!ml_model) return c.text('Missing ML Model');
  if (!town) return c.text('Missing Town');
  if (!storey_range) return c.text('Missing Storey Range');
  if (!flat_model) return c.text('Missing Flat Model');
  if (!floor_area_sqm) return c.text('Missing Floor Area');
  if (!lease_commence_date) return c.text('Missing Lease Commence Date');

  const { results } = await c.env.DB.prepare("SELECT intercept_map, month_map, \
  storey_range_map, floor_area_sqm_map, lease_commence_date_map, \
  towns_onehot.value \
  AS town_map, \
  flat_models_onehot.value \
  AS flat_model_map \
  FROM ((ml_models \
  JOIN towns_onehot \
  ON ml_models.name=towns_onehot.ml_model) \
  JOIN flat_models_onehot \
  ON ml_models.name=flat_models_onehot.ml_model) \
  WHERE ml_models.name=?1 \
  AND towns_onehot.name=?2 \
  AND flat_models_onehot.name=?3;")
    .bind(ml_model, town, flat_model)
    .all();

  return c.json(results);
});

app.onError((err, c) => {
  console.error(`${err}`);
  return c.text(err.toString());
});

app.notFound(c => c.text('Not found', 404));

export default app;
