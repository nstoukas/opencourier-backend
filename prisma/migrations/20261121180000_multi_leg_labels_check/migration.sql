-- Spec 0046 (row 10 review): the first CHECK let one label alone through. With legNumber set and legCount
-- NULL, both of its branches came out NULL rather than false, and Postgres accepts a NULL check. This one
-- counts the labels with num_nonnulls, which is never NULL. The API already answers 400 first.
ALTER TABLE "Delivery" DROP CONSTRAINT "Delivery_leg_labels_consistent";
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_leg_labels_consistent" CHECK (
  num_nonnulls("legNumber", "legCount") = 0
  OR (
    num_nonnulls("legNumber", "legCount") = 2
    AND "legCount" BETWEEN 2 AND 4
    AND "legNumber" BETWEEN 1 AND "legCount"
  )
);
