export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      lobbies: {
        Row: {
          id: string;
          code: string;
          host_id: string | null;
          session_id: string | null;
          status: 'waiting' | 'active' | 'finished';
          current_question_id: string | null;
          question_count: number;
          created_at: string;
          started_at: string | null;
          finished_at: string | null;
          is_public: boolean;
          public_session_key: string | null;
        };
        Insert: {
          id?: string;
          code: string;
          host_id?: string | null;
          session_id?: string | null;
          status?: 'waiting' | 'active' | 'finished';
          current_question_id?: string | null;
          question_count?: number;
          created_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
          is_public?: boolean;
          public_session_key?: string | null;
        };
        Update: {
          id?: string;
          code?: string;
          host_id?: string | null;
          session_id?: string | null;
          status?: 'waiting' | 'active' | 'finished';
          current_question_id?: string | null;
          question_count?: number;
          created_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
          is_public?: boolean;
          public_session_key?: string | null;
        };
      };
      users: {
        Row: {
          id: string;
          username: string;
          lobby_id: string;
          is_host: boolean;
          created_at: string;
          last_active_at: string;
          joined_at_lap: number | null;
        };
        Insert: {
          id?: string;
          username: string;
          lobby_id: string;
          is_host?: boolean;
          created_at?: string;
          last_active_at?: string;
          joined_at_lap?: number | null;
        };
        Update: {
          id?: string;
          username?: string;
          lobby_id?: string;
          is_host?: boolean;
          created_at?: string;
          last_active_at?: string;
          joined_at_lap?: number | null;
        };
      };
      question_instances: {
        Row: {
          id: string;
          lobby_id: string;
          question_id: string;
          question_text: string | null;
          state: QuestionState;
          triggered_at: string;
          locked_at: string | null;
          resolved_at: string | null;
          closed_at: string | null;
          trigger_snapshot: Json;
          window_size: number;
          answer: 'YES' | 'NO' | null;
          outcome: boolean | null;
          explanation: string | null;
          cancelled_reason: string | null;
          cancelled_at: string | null;
        };
        Insert: {
          id?: string;
          lobby_id: string;
          question_id: string;
          question_text?: string | null;
          state?: QuestionState;
          triggered_at?: string;
          locked_at?: string | null;
          resolved_at?: string | null;
          closed_at?: string | null;
          trigger_snapshot: Json;
          window_size: number;
          answer?: 'YES' | 'NO' | null;
          outcome?: boolean | null;
          explanation?: string | null;
          cancelled_reason?: string | null;
          cancelled_at?: string | null;
        };
        Update: {
          id?: string;
          lobby_id?: string;
          question_id?: string;
          question_text?: string | null;
          state?: QuestionState;
          triggered_at?: string;
          locked_at?: string | null;
          resolved_at?: string | null;
          closed_at?: string | null;
          trigger_snapshot?: Json;
          window_size?: number;
          answer?: 'YES' | 'NO' | null;
          outcome?: boolean | null;
          explanation?: string | null;
          cancelled_reason?: string | null;
          cancelled_at?: string | null;
        };
      };
      answers: {
        Row: {
          id: string;
          instance_id: string;
          user_id: string;
          answer: 'YES' | 'NO';
          submitted_at: string;
          response_time_ms: number | null;
        };
        Insert: {
          id?: string;
          instance_id: string;
          user_id: string;
          answer: 'YES' | 'NO';
          submitted_at?: string;
          response_time_ms?: number | null;
        };
        Update: {
          id?: string;
          instance_id?: string;
          user_id?: string;
          answer?: 'YES' | 'NO';
          submitted_at?: string;
          response_time_ms?: number | null;
        };
      };
      admin_credentials: {
        Row: {
          id: string;
          password_hash: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          password_hash: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          password_hash?: string;
          updated_at?: string;
        };
      };
      problem_reports: {
        Row: {
          id: string;
          instance_id: string;
          user_id: string;
          lobby_id: string;
          question_id: string;
          question_text_snapshot: string | null;
          correct_answer_snapshot: 'YES' | 'NO' | null;
          explanation_snapshot: string | null;
          reported_answer_snapshot: 'YES' | 'NO' | null;
          reason: ProblemReportReason;
          note: string | null;
          status: ProblemReportStatus;
          created_at: string;
          updated_at: string;
          reviewed_at: string | null;
        };
        Insert: {
          id?: string;
          instance_id: string;
          user_id: string;
          lobby_id: string;
          question_id: string;
          question_text_snapshot?: string | null;
          correct_answer_snapshot?: 'YES' | 'NO' | null;
          explanation_snapshot?: string | null;
          reported_answer_snapshot?: 'YES' | 'NO' | null;
          reason: ProblemReportReason;
          note?: string | null;
          status?: ProblemReportStatus;
          created_at?: string;
          updated_at?: string;
          reviewed_at?: string | null;
        };
        Update: {
          id?: string;
          instance_id?: string;
          user_id?: string;
          lobby_id?: string;
          question_id?: string;
          question_text_snapshot?: string | null;
          correct_answer_snapshot?: 'YES' | 'NO' | null;
          explanation_snapshot?: string | null;
          reported_answer_snapshot?: 'YES' | 'NO' | null;
          reason?: ProblemReportReason;
          note?: string | null;
          status?: ProblemReportStatus;
          created_at?: string;
          updated_at?: string;
          reviewed_at?: string | null;
        };
      };
      leaderboard: {
        Row: {
          id: string;
          lobby_id: string;
          user_id: string;
          points: number;
          streak: number;
          max_streak: number;
          correct_answers: number;
          wrong_answers: number;
          questions_answered: number;
          accuracy: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          lobby_id: string;
          user_id: string;
          points?: number;
          streak?: number;
          max_streak?: number;
          correct_answers?: number;
          wrong_answers?: number;
          questions_answered?: number;
          accuracy?: number;
          updated_at?: string;
        };
        Update: {
          id?: string;
          lobby_id?: string;
          user_id?: string;
          points?: number;
          streak?: number;
          max_streak?: number;
          correct_answers?: number;
          wrong_answers?: number;
          questions_answered?: number;
          accuracy?: number;
          updated_at?: string;
        };
      };
    };
    Functions: {
      update_leaderboard: {
        Args: {
          p_lobby_id: string;
          p_user_id: string;
          p_points_change: number;
          p_is_correct: boolean;
          p_instance_id: string;
        };
        Returns: boolean;
      };
      join_public_lobby_atomic: {
        Args: {
          p_session_key: string;
          p_max_players: number;
          p_username: string;
          p_current_lap?: number | null;
        };
        Returns: Array<{
          out_lobby_id: string | null;
          out_lobby_code: string | null;
          out_user_id: string | null;
          result_code: string;
        }>;
      };
    };
  };
}

export type QuestionState =
  | 'TRIGGERED'
  | 'LIVE'
  | 'LOCKED'
  | 'ACTIVE'
  | 'RESOLVED'
  | 'EXPLAINED'
  | 'CLOSED'
  | 'CANCELLED';

export type ProblemReportReason =
  | 'WRONG_ANSWER'
  | 'BAD_EXPLANATION'
  | 'UNCLEAR_QUESTION'
  | 'TELEMETRY_MISMATCH'
  | 'OTHER';

export type ProblemReportStatus =
  | 'OPEN'
  | 'REVIEWED'
  | 'RESOLVED'
  | 'DISMISSED';

export type Lobby = Database['public']['Tables']['lobbies']['Row'];
export type User = Database['public']['Tables']['users']['Row'];
export type QuestionInstance = Database['public']['Tables']['question_instances']['Row'];
export type Answer = Database['public']['Tables']['answers']['Row'];
export type AdminCredential = Database['public']['Tables']['admin_credentials']['Row'];
export type ProblemReport = Database['public']['Tables']['problem_reports']['Row'];
export type LeaderboardEntry = Database['public']['Tables']['leaderboard']['Row'];
