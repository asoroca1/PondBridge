import { createModel, toDoc } from "./_factory.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

const COLUMNS = {
  id: "id",
  key: "key",
  city: "city",
  state: "state",
  lat: "lat",
  lng: "lng",
  source: "source",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

const base = createModel("city_geo", COLUMNS);

export const CityGeoModel = {
  ...base,

  async findByKey(key) {
    const { data, error } = await getSupabaseAdmin()
      .from("city_geo")
      .select("*")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return toDoc(data, COLUMNS);
  }
};
