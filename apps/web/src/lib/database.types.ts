// SEMENTARA — ditulis tangan untuk tabel/view yang dipakai web Fase 1, dengan format sama
// seperti keluaran `supabase gen types`. Ganti dengan `pnpm db:types` setelah `supabase start`
// (butuh Docker) agar mencakup seluruh tabel.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<Row, Rel extends Relationship[] = []> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: Rel;
};

export type Database = {
  public: {
    Tables: {
      users: Table<{
        id: string;
        display_name: string | null;
        timezone: string;
        locale: string;
        theme: "violet" | "ember" | "pitch";
        risk_profile: "safe" | "balanced" | "aggressive";
        is_admin: boolean;
        created_at: string;
        updated_at: string;
      }>;
      gameweeks: Table<{
        id: number;
        season_id: number;
        number: number;
        fpl_event_id: number | null;
        deadline_utc: string;
        is_current: boolean;
        is_next: boolean;
        is_finished: boolean;
        bonus_confirmed: boolean;
        leagues_updated: boolean;
        scores_final_at: string | null;
        is_blank: boolean;
        is_double: boolean;
        updated_at: string;
      }>;
      job_runs: Table<{
        id: number;
        job_name: string;
        scheduled_for: string | null;
        started_at: string;
        finished_at: string | null;
        status: "running" | "ok" | "failed" | "skipped";
        stats: Json | null;
        error: string | null;
      }>;
      fixture_changes: Table<{
        id: number;
        fixture_id: number;
        detected_at: string;
        change_type: string;
        old_value: Json | null;
        new_value: Json | null;
        source: string;
        reason: string | null;
        notified: boolean;
      }>;
      seasons: Table<{
        id: number;
        label: string;
        start_date: string;
        end_date: string | null;
        is_current: boolean;
      }>;
      fixtures: Table<{
        id: number;
        season_id: number;
        competition_id: number;
        gameweek_id: number | null;
        home_team_id: number;
        away_team_id: number;
        kickoff_utc: string | null;
        status: "scheduled" | "tbc" | "live" | "ht" | "finished" | "postponed" | "cancelled" | "abandoned";
        minute: number | null;
        home_goals: number | null;
        away_goals: number | null;
        difficulty_home: number | null;
        difficulty_away: number | null;
        fpl_fixture_id: number | null;
      }>;
      teams: Table<{
        id: number;
        name: string;
        short_name: string | null;
        fpl_team_code: number | null;
        primary_color: string | null;
        secondary_color: string | null;
      }>;
      team_seasons: Table<{
        team_id: number;
        season_id: number;
        fpl_team_id: number | null;
        league_code: string;
        is_promoted: boolean;
      }>;
      model_evaluations: Table<{
        gameweek_id: number;
        model_version: string;
        metric: string;
        value: number;
        detail: Json | null;
        created_at: string;
      }>;
      model_runs: Table<{
        id: number;
        gameweek_id: number;
        run_type: string;
        model_version: string;
        status: string;
        finished_at: string | null;
        notes: Json | null;
      }>;
      projections: Table<{
        id: number;
        model_run_id: number;
        player_id: number;
        fixture_id: number;
        xmins: number | null;
        xpts: number;
        component_breakdown: Json | null;
      }>;
      lineups: Table<
        {
          fixture_id: number;
          team_id: number;
          player_id: number;
          is_starter: boolean;
          formation: string | null;
          grid_position: string | null;
          position_label: string | null;
          minute_on: number | null;
          minute_off: number | null;
          source: string;
        },
        [
          {
            foreignKeyName: "lineups_fixture_id_fkey";
            columns: ["fixture_id"];
            isOneToOne: false;
            referencedRelation: "fixtures";
            referencedColumns: ["id"];
          },
        ]
      >;
      player_match_stats: Table<
        {
          fixture_id: number;
          player_id: number;
          team_id: number | null;
          source: string;
          minutes: number | null;
          goals: number | null;
          assists: number | null;
          shots: number | null;
          key_passes: number | null;
          xg: number | null;
          npxg: number | null;
          xa: number | null;
          yellow_cards: number | null;
          red_cards: number | null;
          extra: Json | null;
        },
        [
          {
            foreignKeyName: "player_match_stats_fixture_id_fkey";
            columns: ["fixture_id"];
            isOneToOne: false;
            referencedRelation: "fixtures";
            referencedColumns: ["id"];
          },
        ]
      >;
      player_form_features: Table<{
        player_id: number;
        as_of: string;
        window_label: string;
        metrics: Json;
        sample_minutes: number;
      }>;
      fpl_chips: Table<{
        season_id: number;
        chip_id: number;
        name: string;
        number: number;
        start_event: number;
        stop_event: number;
        chip_type: string | null;
        updated_at: string;
      }>;
      analysis_reports: Table<{
        id: number;
        gameweek_id: number;
        model_run_id: number | null;
        report_type: string;
        status: string;
        title: string | null;
        content_json: Json | null;
        created_at: string;
      }>;
      players: Table<{
        id: number;
        full_name: string;
        web_name: string;
        fpl_code: number | null;
        photo_file: string | null;
        photo_url_resolved: string | null;
      }>;
      player_seasons: Table<{
        player_id: number;
        season_id: number;
        team_id: number;
        fpl_element_id: number | null;
        fpl_position: "GKP" | "DEF" | "MID" | "FWD" | null;
        real_position: string | null;
        joined_on: string | null;
        left_on: string | null;
      }>;
      price_snapshots: Table<{
        player_id: number;
        captured_on: string;
        price_tenths: number;
        selected_by_pct: number | null;
        transfers_in_event: number | null;
        transfers_out_event: number | null;
        price_change_progress: number | null;
      }>;
      player_fpl_gw_stats: Table<
        {
          player_id: number;
          fixture_id: number;
          gameweek_id: number;
          minutes: number | null;
          total_points: number | null;
          bonus: number | null;
          goals_scored: number | null;
          assists: number | null;
          expected_goals: number | null;
          expected_assists: number | null;
          is_final: boolean;
          team_id: number | null;
          opponent_team_id: number | null;
          was_home: boolean | null;
          starts: number | null;
          fpl_xp: number | null;
          source: string;
          bps: number | null;
          clean_sheets: number | null;
          goals_conceded: number | null;
          own_goals: number | null;
          penalties_saved: number | null;
          penalties_missed: number | null;
          yellow_cards: number | null;
          red_cards: number | null;
          saves: number | null;
          defensive_contribution: number | null;
          defcon_points: number | null;
          expected_goals_conceded: number | null;
          influence: number | null;
          creativity: number | null;
          threat: number | null;
          ict_index: number | null;
        },
        [
          {
            foreignKeyName: "player_fpl_gw_stats_fixture_id_fkey";
            columns: ["fixture_id"];
            isOneToOne: false;
            referencedRelation: "fixtures";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "player_fpl_gw_stats_gameweek_id_fkey";
            columns: ["gameweek_id"];
            isOneToOne: false;
            referencedRelation: "gameweeks";
            referencedColumns: ["id"];
          },
        ]
      >;
    };
    Views: {
      v_player_current: {
        Row: {
          id: number | null;
          web_name: string | null;
          full_name: string | null;
          fpl_code: number | null;
          photo_file: string | null;
          photo_url_resolved: string | null;
          team_id: number | null;
          team_short_name: string | null;
          fpl_element_id: number | null;
          fpl_position: string | null;
          real_position: string | null;
          status: string | null;
          chance_next: number | null;
          news: string | null;
          status_captured_at: string | null;
          price_tenths: number | null;
          selected_by_pct: number | null;
        };
        Relationships: [];
      };
      v_player_form: {
        Row: {
          player_id: number | null;
          as_of: string | null;
          form_label: string | null;
          form_score: number | null;
          form_trend: number | null;
          form_reasons: Json | null;
          last4_points_per_match: number | null;
          last4_xgi90: number | null;
          last4_minutes_share: number | null;
          last4_goals_minus_xg: number | null;
          season_points_per_match: number | null;
          season_xgi90: number | null;
          last4_minutes: number | null;
        };
        Relationships: [];
      };
      v_next_gw_fixtures: {
        Row: {
          id: number | null;
          gw: number | null;
          home_team_id: number | null;
          home: string | null;
          away_team_id: number | null;
          away: string | null;
          kickoff_utc: string | null;
          kickoff_wib: string | null;
          status: string | null;
          difficulty_home: number | null;
          difficulty_away: number | null;
          recently_changed: boolean | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
