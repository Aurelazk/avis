import "server-only";
import { cache } from "react";
import type { Admin, Company } from "@/server/domain";
import { findAdminById } from "@/server/repositories/admin-repository";
import {
  findCompanyByUserId,
  findCompanyByUserIdIncludingDeleted,
} from "@/server/repositories/company-repository";
import { getAuthUser, type AuthUser } from "./session";

/**
 * État du compte pour la requête courante.
 *
 * La session Supabase ne dit pas si l'utilisateur est une entreprise, un
 * administrateur, un compte en cours de création ou un compte dont la fiche
 * a été supprimée : les droits se déduisent des tables `admins` et
 * `companies`. Cette résolution est faite une seule fois par requête, et
 * partagée par les gardes et les pages.
 */
export type AccountState =
  | { kind: "anonymous" }
  | { kind: "company"; company: Company }
  | { kind: "admin"; admin: Admin }
  /** Session ouverte, aucune fiche entreprise : l'onboarding est requis. */
  | { kind: "onboarding" }
  /** Fiche entreprise supprimée : le compte ne peut plus accéder à l'espace. */
  | { kind: "deleted"; company: Company };

export const getAccountState = cache(async (): Promise<AccountState> => {
  let user: AuthUser | null = null;
  try {
    user = await getAuthUser();
  } catch {
    // La session Supabase est indisponible (réseau, cookie invalide) :
    // on traite comme un visiteur non connecté plutôt que de planter.
    return { kind: "anonymous" };
  }
  if (!user) return { kind: "anonymous" };

  const admin = await findAdminById(user.id);
  if (admin) return { kind: "admin", admin };

  let company: Company | null = null;
  try {
    company = await findCompanyByUserId(user.id);
  } catch {
    // Lecture `companies` indisponible (table manquante, RLS, connexion) :
    // on traite comme si aucune fiche n'existait, plutôt que de planter la page.
    company = null;
  }
  if (company) return { kind: "company", company };

  try {
    const includingDeleted = await findCompanyByUserIdIncludingDeleted(user.id);
    if (includingDeleted?.deleted) {
      return { kind: "deleted", company: includingDeleted.company };
    }
  } catch {
    // Même traitement : échec de lecture, on ignore et on passe à onboarding.
  }

  return { kind: "onboarding" };
});
