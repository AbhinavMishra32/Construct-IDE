ALTER TABLE "construct_blueprints"
DROP COLUMN IF EXISTS "learning_style";

ALTER TABLE "construct_blueprint_builds"
DROP COLUMN IF EXISTS "learning_style";
