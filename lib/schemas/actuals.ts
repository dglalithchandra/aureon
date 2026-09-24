import { z } from "zod";
import { ModuleSizeSchema } from "@/lib/schemas/extraction";

/**
 * What someone types when a project is finished (the calibration loop).
 *
 * Bounded like everything else the app stores: a project that took 300
 * weeks with 40 people is a typo, and a 4,000-character note is a diary.
 */

export const ActualModuleSchema = z.object({
  /** The module's name in the scope, so the form can show what it is. */
  name: z.string().min(1).max(80),
  /** The size the scope gave it, snapshotted here. */
  estimatedSize: ModuleSizeSchema,
  /** What it turned out to be. */
  actualSize: ModuleSizeSchema,
  /** Sprints it actually took. Halves are allowed: work is not tidy. */
  actualSprints: z.number().min(0).max(100),
});
export type ActualModule = z.infer<typeof ActualModuleSchema>;

/** The stored `modules` column, re-validated on read. */
export const ActualsModulesSchema = z.array(ActualModuleSchema).max(40);

export const RecordActualsSchema = z.object({
  actualWeeks: z.number().int().min(1).max(260),
  actualTeamSize: z.number().int().min(1).max(60),
  /** 1 nothing like the scope, 5 the scope was right. */
  scopeAccuracy: z.number().int().min(1).max(5),
  note: z.string().max(2_000).optional().default(""),
  modules: z.array(ActualModuleSchema).max(40).default([]),
});
export type RecordActualsInput = z.infer<typeof RecordActualsSchema>;

/** What the API answers with, and what the form reads back. */
export const StoredActualsSchema = RecordActualsSchema.extend({
  projectId: z.string().uuid(),
  domain: z.string(),
  estimatedSprints: z.number().int(),
  estimatedPoints: z.number().int(),
  estimatedTeamSize: z.number().int(),
  estimatedVelocity: z.number().int(),
  domainMultiplier: z.number(),
  recordedAt: z.number().int(),
});
export type StoredActuals = z.infer<typeof StoredActualsSchema>;
