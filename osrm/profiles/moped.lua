-- Moped profile for OpenCourier. Derived from OSRM's stock car.lua: mopeds follow car
-- road rules in Greece, so the car network is right; only the speed and the motorway ban
-- differ. Mounted at /opt/moped.lua inside the OSRM container, next to the stock car.lua.
local car = require("car")

-- Design speed of a 50cc moped (μοτοποδήλατο), km/h. This number shapes every routed
-- duration, so it is kept here as one named, member-adjustable constant rather than
-- buried in TypeScript. Changing it requires re-running osrm-extract (see
-- docs/osrm-routing.md) — the speed is baked into the prepared data, not read at runtime.
local MOPED_MAX_SPEED_KMH = 45

function setup()
  local profile = car.setup()

  -- Mopeds are banned from motorways. profile.avoid is a plain Lua set of tag values.
  profile.avoid['motorway'] = true
  profile.avoid['motorway_link'] = true

  return profile
end

function process_way(profile, way, result, relations)
  car.process_way(profile, way, result, relations)

  -- Cap whatever speed the car profile assigned. A moped cannot do 90 km/h on a trunk road.
  if result.forward_speed and result.forward_speed > MOPED_MAX_SPEED_KMH then
    result.forward_speed = MOPED_MAX_SPEED_KMH
  end
  if result.backward_speed and result.backward_speed > MOPED_MAX_SPEED_KMH then
    result.backward_speed = MOPED_MAX_SPEED_KMH
  end
end

return {
  setup = setup,
  process_way = process_way,
  process_node = car.process_node,
  process_turn = car.process_turn,
}
