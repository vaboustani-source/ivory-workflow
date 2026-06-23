export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action_type: string | null
          client_facing_text: string | null
          client_id: string | null
          created_at: string
          description: string | null
          id: string
          is_client_visible: boolean
          metadata: Json | null
          target_id: string | null
          target_type: string | null
          user_id: string | null
        }
        Insert: {
          action_type?: string | null
          client_facing_text?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_client_visible?: boolean
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Update: {
          action_type?: string | null
          client_facing_text?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_client_visible?: boolean
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      albums: {
        Row: {
          client_id: string | null
          delivered_at: string | null
          id: string
          ordered_at: string | null
          proof_url: string | null
          questionnaire_responses: Json | null
          revision_count: number | null
          status: Database["public"]["Enums"]["album_status"]
          tracking_number: string | null
        }
        Insert: {
          client_id?: string | null
          delivered_at?: string | null
          id?: string
          ordered_at?: string | null
          proof_url?: string | null
          questionnaire_responses?: Json | null
          revision_count?: number | null
          status?: Database["public"]["Enums"]["album_status"]
          tracking_number?: string | null
        }
        Update: {
          client_id?: string | null
          delivered_at?: string | null
          id?: string
          ordered_at?: string | null
          proof_url?: string | null
          questionnaire_responses?: Json | null
          revision_count?: number | null
          status?: Database["public"]["Enums"]["album_status"]
          tracking_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "albums_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_reminders: {
        Row: {
          attempt_count: number
          booking_id: string
          created_at: string
          email_send_id: string | null
          id: string
          kind: Database["public"]["Enums"]["booking_reminder_kind"]
          last_error: string | null
          postmark_message_id: string | null
          send_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["booking_reminder_status"]
        }
        Insert: {
          attempt_count?: number
          booking_id: string
          created_at?: string
          email_send_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["booking_reminder_kind"]
          last_error?: string | null
          postmark_message_id?: string | null
          send_at: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["booking_reminder_status"]
        }
        Update: {
          attempt_count?: number
          booking_id?: string
          created_at?: string
          email_send_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["booking_reminder_kind"]
          last_error?: string | null
          postmark_message_id?: string | null
          send_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["booking_reminder_status"]
        }
        Relationships: [
          {
            foreignKeyName: "booking_reminders_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_reminders_email_send_id_fkey"
            columns: ["email_send_id"]
            isOneToOne: false
            referencedRelation: "email_sends"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          call_type_id: string
          cancel_token: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by:
            | Database["public"]["Enums"]["booking_cancelled_by"]
            | null
          client_id: string | null
          couple_name_1: string
          couple_name_2: string | null
          created_at: string
          custom_field_responses: Json
          ends_at: string
          google_calendar_event_id: string | null
          google_calendar_id: string | null
          id: string
          idempotency_key: string | null
          invite_token: string | null
          phone: string | null
          primary_email: string
          reschedule_token: string
          rescheduled_from_booking_id: string | null
          source: Database["public"]["Enums"]["booking_source"]
          starts_at: string
          status: Database["public"]["Enums"]["booking_status"]
          timezone_snapshot: string
          updated_at: string
          visitor_timezone: string | null
          zoom_join_url: string | null
          zoom_meeting_id: string | null
          zoom_password: string | null
        }
        Insert: {
          call_type_id: string
          cancel_token?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?:
            | Database["public"]["Enums"]["booking_cancelled_by"]
            | null
          client_id?: string | null
          couple_name_1: string
          couple_name_2?: string | null
          created_at?: string
          custom_field_responses?: Json
          ends_at: string
          google_calendar_event_id?: string | null
          google_calendar_id?: string | null
          id?: string
          idempotency_key?: string | null
          invite_token?: string | null
          phone?: string | null
          primary_email: string
          reschedule_token?: string
          rescheduled_from_booking_id?: string | null
          source?: Database["public"]["Enums"]["booking_source"]
          starts_at: string
          status?: Database["public"]["Enums"]["booking_status"]
          timezone_snapshot: string
          updated_at?: string
          visitor_timezone?: string | null
          zoom_join_url?: string | null
          zoom_meeting_id?: string | null
          zoom_password?: string | null
        }
        Update: {
          call_type_id?: string
          cancel_token?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?:
            | Database["public"]["Enums"]["booking_cancelled_by"]
            | null
          client_id?: string | null
          couple_name_1?: string
          couple_name_2?: string | null
          created_at?: string
          custom_field_responses?: Json
          ends_at?: string
          google_calendar_event_id?: string | null
          google_calendar_id?: string | null
          id?: string
          idempotency_key?: string | null
          invite_token?: string | null
          phone?: string | null
          primary_email?: string
          reschedule_token?: string
          rescheduled_from_booking_id?: string | null
          source?: Database["public"]["Enums"]["booking_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["booking_status"]
          timezone_snapshot?: string
          updated_at?: string
          visitor_timezone?: string | null
          zoom_join_url?: string | null
          zoom_meeting_id?: string | null
          zoom_password?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_call_type_id_fkey"
            columns: ["call_type_id"]
            isOneToOne: false
            referencedRelation: "call_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_client_id_fkey1"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_rescheduled_from_booking_id_fkey"
            columns: ["rescheduled_from_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      briefings: {
        Row: {
          ai_summary: string | null
          created_at: string
          data: Json
          email_sent_at: string | null
          email_sent_to: string | null
          generated_at: string
          generated_by: string
          id: string
          period_end: string
          period_start: string
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string
          data: Json
          email_sent_at?: string | null
          email_sent_to?: string | null
          generated_at?: string
          generated_by?: string
          id?: string
          period_end: string
          period_start: string
        }
        Update: {
          ai_summary?: string | null
          created_at?: string
          data?: Json
          email_sent_at?: string | null
          email_sent_to?: string | null
          generated_at?: string
          generated_by?: string
          id?: string
          period_end?: string
          period_start?: string
        }
        Relationships: []
      }
      business_calendar_holidays: {
        Row: {
          created_at: string
          holiday_date: string
          id: string
          is_observed: boolean
          name: string
        }
        Insert: {
          created_at?: string
          holiday_date: string
          id?: string
          is_observed?: boolean
          name: string
        }
        Update: {
          created_at?: string
          holiday_date?: string
          id?: string
          is_observed?: boolean
          name?: string
        }
        Relationships: []
      }
      calendar_availability_rules: {
        Row: {
          available_days: Json | null
          available_hours: Json | null
          buffer_after_minutes: number | null
          buffer_before_minutes: number | null
          duration_minutes: number | null
          event_type:
            | Database["public"]["Enums"]["availability_event_type"]
            | null
          id: string
          is_active: boolean | null
          max_advance_days: number | null
          min_notice_hours: number | null
          user_id: string | null
        }
        Insert: {
          available_days?: Json | null
          available_hours?: Json | null
          buffer_after_minutes?: number | null
          buffer_before_minutes?: number | null
          duration_minutes?: number | null
          event_type?:
            | Database["public"]["Enums"]["availability_event_type"]
            | null
          id?: string
          is_active?: boolean | null
          max_advance_days?: number | null
          min_notice_hours?: number | null
          user_id?: string | null
        }
        Update: {
          available_days?: Json | null
          available_hours?: Json | null
          buffer_after_minutes?: number | null
          buffer_before_minutes?: number | null
          duration_minutes?: number | null
          event_type?:
            | Database["public"]["Enums"]["availability_event_type"]
            | null
          id?: string
          is_active?: boolean | null
          max_advance_days?: number | null
          min_notice_hours?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_availability_rules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_connections: {
        Row: {
          access_token: string | null
          account_email: string | null
          calendar_id: string | null
          created_at: string
          id: string
          is_active: boolean | null
          last_synced_at: string | null
          provider: Database["public"]["Enums"]["calendar_provider"] | null
          refresh_token: string | null
          scopes: string[] | null
          token_expires_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          access_token?: string | null
          account_email?: string | null
          calendar_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          provider?: Database["public"]["Enums"]["calendar_provider"] | null
          refresh_token?: string | null
          scopes?: string[] | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          access_token?: string | null
          account_email?: string | null
          calendar_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          provider?: Database["public"]["Enums"]["calendar_provider"] | null
          refresh_token?: string | null
          scopes?: string[] | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      call_type_fields: {
        Row: {
          call_type_id: string
          created_at: string
          display_order: number
          field_key: string
          field_type: Database["public"]["Enums"]["call_type_field_type"]
          id: string
          is_required: boolean
          label: string
          options: Json | null
          placeholder: string | null
          updated_at: string
        }
        Insert: {
          call_type_id: string
          created_at?: string
          display_order?: number
          field_key: string
          field_type: Database["public"]["Enums"]["call_type_field_type"]
          id?: string
          is_required?: boolean
          label: string
          options?: Json | null
          placeholder?: string | null
          updated_at?: string
        }
        Update: {
          call_type_id?: string
          created_at?: string
          display_order?: number
          field_key?: string
          field_type?: Database["public"]["Enums"]["call_type_field_type"]
          id?: string
          is_required?: boolean
          label?: string
          options?: Json | null
          placeholder?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_type_fields_call_type_id_fkey"
            columns: ["call_type_id"]
            isOneToOne: false
            referencedRelation: "call_types"
            referencedColumns: ["id"]
          },
        ]
      }
      call_types: {
        Row: {
          color: string
          created_at: string
          description: string | null
          display_order: number
          duration_minutes: number
          id: string
          is_active: boolean
          location_type: Database["public"]["Enums"]["call_location_type"]
          name: string
          pipeline_stage_on_book: string
          slug: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          display_order?: number
          duration_minutes: number
          id?: string
          is_active?: boolean
          location_type?: Database["public"]["Enums"]["call_location_type"]
          name: string
          pipeline_stage_on_book?: string
          slug: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          display_order?: number
          duration_minutes?: number
          id?: string
          is_active?: boolean
          location_type?: Database["public"]["Enums"]["call_location_type"]
          name?: string
          pipeline_stage_on_book?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_users: {
        Row: {
          client_id: string
          created_at: string
          id: string
          notification_email_enabled: boolean
          notification_messages_enabled: boolean
          notification_milestones_enabled: boolean
          partner_email: string | null
          partner_invited_at: string | null
          role_in_couple: string | null
          user_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          notification_email_enabled?: boolean
          notification_messages_enabled?: boolean
          notification_milestones_enabled?: boolean
          partner_email?: string | null
          partner_invited_at?: string | null
          role_in_couple?: string | null
          user_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          notification_email_enabled?: boolean
          notification_messages_enabled?: boolean
          notification_milestones_enabled?: boolean
          partner_email?: string | null
          partner_invited_at?: string | null
          role_in_couple?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_users_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          album_workflow_activated_at: string | null
          album_workflow_active: boolean
          alternate_client_last_name: string | null
          alternate_client_phone: string | null
          booked_at: string | null
          couple_name_1: string
          couple_name_2: string | null
          coverage_hours: number | null
          created_at: string
          editing_rate_per_image: number | null
          final_image_count: number | null
          guest_count: number | null
          has_album: boolean | null
          has_engagement: boolean | null
          has_videography: boolean | null
          id: string
          inquiry_source: string | null
          is_tbd_booking: boolean
          last_contacted_at: string | null
          manager_id: string | null
          notes: string | null
          package_id: string | null
          package_price: number | null
          phone: string | null
          photographer_id: string | null
          pipeline_stage: string | null
          portal_first_login_at: string | null
          portal_invited_at: string | null
          portal_login_mode: string | null
          primary_client_last_name: string | null
          primary_client_phone: string | null
          primary_email: string
          production_stage_override: string | null
          production_stage_override_at: string | null
          production_stage_override_by: string | null
          secondary_email: string | null
          services_added: Json
          shared_city: string | null
          shared_state: string | null
          shared_street_address: string | null
          shared_zipcode: string | null
          status: Database["public"]["Enums"]["client_status"]
          tbd_booked_at: string | null
          tbd_cancellation_reason: string | null
          tbd_cancelled_at: string | null
          tbd_deposit_amount_cents: number | null
          tbd_deposit_invoice_id: string | null
          tbd_finalize_by: string | null
          updated_at: string
          venue_address: string | null
          venue_city: string | null
          venue_name: string | null
          venue_postal_code: string | null
          venue_state: string | null
          venue_street: string | null
          wedding_date: string | null
        }
        Insert: {
          album_workflow_activated_at?: string | null
          album_workflow_active?: boolean
          alternate_client_last_name?: string | null
          alternate_client_phone?: string | null
          booked_at?: string | null
          couple_name_1: string
          couple_name_2?: string | null
          coverage_hours?: number | null
          created_at?: string
          editing_rate_per_image?: number | null
          final_image_count?: number | null
          guest_count?: number | null
          has_album?: boolean | null
          has_engagement?: boolean | null
          has_videography?: boolean | null
          id?: string
          inquiry_source?: string | null
          is_tbd_booking?: boolean
          last_contacted_at?: string | null
          manager_id?: string | null
          notes?: string | null
          package_id?: string | null
          package_price?: number | null
          phone?: string | null
          photographer_id?: string | null
          pipeline_stage?: string | null
          portal_first_login_at?: string | null
          portal_invited_at?: string | null
          portal_login_mode?: string | null
          primary_client_last_name?: string | null
          primary_client_phone?: string | null
          primary_email: string
          production_stage_override?: string | null
          production_stage_override_at?: string | null
          production_stage_override_by?: string | null
          secondary_email?: string | null
          services_added?: Json
          shared_city?: string | null
          shared_state?: string | null
          shared_street_address?: string | null
          shared_zipcode?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          tbd_booked_at?: string | null
          tbd_cancellation_reason?: string | null
          tbd_cancelled_at?: string | null
          tbd_deposit_amount_cents?: number | null
          tbd_deposit_invoice_id?: string | null
          tbd_finalize_by?: string | null
          updated_at?: string
          venue_address?: string | null
          venue_city?: string | null
          venue_name?: string | null
          venue_postal_code?: string | null
          venue_state?: string | null
          venue_street?: string | null
          wedding_date?: string | null
        }
        Update: {
          album_workflow_activated_at?: string | null
          album_workflow_active?: boolean
          alternate_client_last_name?: string | null
          alternate_client_phone?: string | null
          booked_at?: string | null
          couple_name_1?: string
          couple_name_2?: string | null
          coverage_hours?: number | null
          created_at?: string
          editing_rate_per_image?: number | null
          final_image_count?: number | null
          guest_count?: number | null
          has_album?: boolean | null
          has_engagement?: boolean | null
          has_videography?: boolean | null
          id?: string
          inquiry_source?: string | null
          is_tbd_booking?: boolean
          last_contacted_at?: string | null
          manager_id?: string | null
          notes?: string | null
          package_id?: string | null
          package_price?: number | null
          phone?: string | null
          photographer_id?: string | null
          pipeline_stage?: string | null
          portal_first_login_at?: string | null
          portal_invited_at?: string | null
          portal_login_mode?: string | null
          primary_client_last_name?: string | null
          primary_client_phone?: string | null
          primary_email?: string
          production_stage_override?: string | null
          production_stage_override_at?: string | null
          production_stage_override_by?: string | null
          secondary_email?: string | null
          services_added?: Json
          shared_city?: string | null
          shared_state?: string | null
          shared_street_address?: string | null
          shared_zipcode?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          tbd_booked_at?: string | null
          tbd_cancellation_reason?: string | null
          tbd_cancelled_at?: string | null
          tbd_deposit_amount_cents?: number | null
          tbd_deposit_invoice_id?: string | null
          tbd_finalize_by?: string | null
          updated_at?: string
          venue_address?: string | null
          venue_city?: string | null
          venue_name?: string | null
          venue_postal_code?: string | null
          venue_state?: string | null
          venue_street?: string | null
          wedding_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_photographer_id_fkey"
            columns: ["photographer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_production_stage_override_by_fkey"
            columns: ["production_stage_override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_tbd_deposit_invoice_id_fkey"
            columns: ["tbd_deposit_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_block_responses: {
        Row: {
          contract_block_id: string
          id: string
          ip_address: string | null
          responded_at: string
          response_data: Json
          response_text: string | null
          signer_role: string | null
          user_agent: string | null
        }
        Insert: {
          contract_block_id: string
          id?: string
          ip_address?: string | null
          responded_at?: string
          response_data?: Json
          response_text?: string | null
          signer_role?: string | null
          user_agent?: string | null
        }
        Update: {
          contract_block_id?: string
          id?: string
          ip_address?: string | null
          responded_at?: string
          response_data?: Json
          response_text?: string | null
          signer_role?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_block_responses_contract_block_id_fkey"
            columns: ["contract_block_id"]
            isOneToOne: false
            referencedRelation: "contract_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_blocks: {
        Row: {
          block_type: Database["public"]["Enums"]["contract_block_type"]
          config: Json
          content: string | null
          contract_id: string
          created_at: string
          id: string
          position: number
          signer_role: string | null
        }
        Insert: {
          block_type: Database["public"]["Enums"]["contract_block_type"]
          config?: Json
          content?: string | null
          contract_id: string
          created_at?: string
          id?: string
          position: number
          signer_role?: string | null
        }
        Update: {
          block_type?: Database["public"]["Enums"]["contract_block_type"]
          config?: Json
          content?: string | null
          contract_id?: string
          created_at?: string
          id?: string
          position?: number
          signer_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_blocks_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_signatures: {
        Row: {
          agreed_to_terms: boolean
          client_id: string
          contract_id: string
          contract_version_hash: string
          id: string
          ip_address: string | null
          signed_at: string
          signed_by_user_id: string
          typed_name: string
          user_agent: string | null
        }
        Insert: {
          agreed_to_terms?: boolean
          client_id: string
          contract_id: string
          contract_version_hash: string
          id?: string
          ip_address?: string | null
          signed_at?: string
          signed_by_user_id: string
          typed_name: string
          user_agent?: string | null
        }
        Update: {
          agreed_to_terms?: boolean
          client_id?: string
          contract_id?: string
          contract_version_hash?: string
          id?: string
          ip_address?: string | null
          signed_at?: string
          signed_by_user_id?: string
          typed_name?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_signatures_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_signatures_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_signatures_signed_by_user_id_fkey"
            columns: ["signed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_signers: {
        Row: {
          contract_id: string
          created_at: string
          email: string | null
          id: string
          ip_address: string | null
          name: string | null
          public_token: string | null
          public_token_expires_at: string | null
          signed_at: string | null
          signer_role: string
          user_agent: string | null
        }
        Insert: {
          contract_id: string
          created_at?: string
          email?: string | null
          id?: string
          ip_address?: string | null
          name?: string | null
          public_token?: string | null
          public_token_expires_at?: string | null
          signed_at?: string | null
          signer_role: string
          user_agent?: string | null
        }
        Update: {
          contract_id?: string
          created_at?: string
          email?: string | null
          id?: string
          ip_address?: string | null
          name?: string | null
          public_token?: string | null
          public_token_expires_at?: string | null
          signed_at?: string | null
          signer_role?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_signers_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_template_blocks: {
        Row: {
          block_type: Database["public"]["Enums"]["contract_block_type"]
          config: Json
          content: string | null
          created_at: string
          id: string
          position: number
          template_id: string
          updated_at: string
        }
        Insert: {
          block_type: Database["public"]["Enums"]["contract_block_type"]
          config?: Json
          content?: string | null
          created_at?: string
          id?: string
          position: number
          template_id: string
          updated_at?: string
        }
        Update: {
          block_type?: Database["public"]["Enums"]["contract_block_type"]
          config?: Json
          content?: string | null
          created_at?: string
          id?: string
          position?: number
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_template_blocks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "contract_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_templates: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          is_block_based: boolean
          name: string
          signature_required_role: string
          template_type: string
          updated_at: string
        }
        Insert: {
          content?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          is_block_based?: boolean
          name: string
          signature_required_role?: string
          template_type?: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          is_block_based?: boolean
          name?: string
          signature_required_role?: string
          template_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_service_requests: {
        Row: {
          agreed_hourly_rate: number | null
          agreed_hours: number | null
          agreed_total: number | null
          ceremony_address: string | null
          client_id: string
          contract_id: string | null
          contractor_id: string
          created_at: string
          id: string
          notes: string | null
          responded_at: string | null
          response_logged_at: string | null
          response_logged_by: string | null
          response_message: string | null
          role: Database["public"]["Enums"]["contractor_role"]
          sent_at: string
          sent_by: string | null
          status: Database["public"]["Enums"]["service_request_status"]
          travel_distance_miles: number | null
          travel_minutes: number | null
          updated_at: string
          wedding_date: string
        }
        Insert: {
          agreed_hourly_rate?: number | null
          agreed_hours?: number | null
          agreed_total?: number | null
          ceremony_address?: string | null
          client_id: string
          contract_id?: string | null
          contractor_id: string
          created_at?: string
          id?: string
          notes?: string | null
          responded_at?: string | null
          response_logged_at?: string | null
          response_logged_by?: string | null
          response_message?: string | null
          role: Database["public"]["Enums"]["contractor_role"]
          sent_at?: string
          sent_by?: string | null
          status?: Database["public"]["Enums"]["service_request_status"]
          travel_distance_miles?: number | null
          travel_minutes?: number | null
          updated_at?: string
          wedding_date: string
        }
        Update: {
          agreed_hourly_rate?: number | null
          agreed_hours?: number | null
          agreed_total?: number | null
          ceremony_address?: string | null
          client_id?: string
          contract_id?: string | null
          contractor_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          responded_at?: string | null
          response_logged_at?: string | null
          response_logged_by?: string | null
          response_message?: string | null
          role?: Database["public"]["Enums"]["contractor_role"]
          sent_at?: string
          sent_by?: string | null
          status?: Database["public"]["Enums"]["service_request_status"]
          travel_distance_miles?: number | null
          travel_minutes?: number | null
          updated_at?: string
          wedding_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_service_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_service_requests_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_service_requests_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_service_requests_response_logged_by_fkey"
            columns: ["response_logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_service_requests_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_w9_requests: {
        Row: {
          contractor_id: string
          created_by: string | null
          email_send_id: string | null
          id: string
          requested_at: string
          status: string
          tax_year: number
        }
        Insert: {
          contractor_id: string
          created_by?: string | null
          email_send_id?: string | null
          id?: string
          requested_at?: string
          status?: string
          tax_year: number
        }
        Update: {
          contractor_id?: string
          created_by?: string | null
          email_send_id?: string | null
          id?: string
          requested_at?: string
          status?: string
          tax_year?: number
        }
        Relationships: [
          {
            foreignKeyName: "contractor_w9_requests_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_w9_requests_email_send_id_fkey"
            columns: ["email_send_id"]
            isOneToOne: false
            referencedRelation: "email_sends"
            referencedColumns: ["id"]
          },
        ]
      }
      contractors: {
        Row: {
          bio: string | null
          business_type: string | null
          created_at: string
          email: string
          full_name: string
          homebase_address: string | null
          homebase_lat: number | null
          homebase_lng: number | null
          id: string
          instagram: string | null
          is_active: boolean
          jobs_count: number
          last_worked_with_at: string | null
          legal_name: string | null
          mailing_address: string | null
          notes: string | null
          phone: string | null
          portfolio_url: string | null
          preferred_max_hourly_rate: number | null
          preferred_min_hourly_rate: number | null
          rate_notes: string | null
          roles: Database["public"]["Enums"]["contractor_role"][]
          tax_id_type: string | null
          tax_id_vault_secret_id: string | null
          updated_at: string
          w9_collected: boolean
          w9_collected_at: string | null
          w9_file_path: string | null
          w9_original_filename: string | null
          w9_requested_at: string | null
        }
        Insert: {
          bio?: string | null
          business_type?: string | null
          created_at?: string
          email: string
          full_name: string
          homebase_address?: string | null
          homebase_lat?: number | null
          homebase_lng?: number | null
          id?: string
          instagram?: string | null
          is_active?: boolean
          jobs_count?: number
          last_worked_with_at?: string | null
          legal_name?: string | null
          mailing_address?: string | null
          notes?: string | null
          phone?: string | null
          portfolio_url?: string | null
          preferred_max_hourly_rate?: number | null
          preferred_min_hourly_rate?: number | null
          rate_notes?: string | null
          roles?: Database["public"]["Enums"]["contractor_role"][]
          tax_id_type?: string | null
          tax_id_vault_secret_id?: string | null
          updated_at?: string
          w9_collected?: boolean
          w9_collected_at?: string | null
          w9_file_path?: string | null
          w9_original_filename?: string | null
          w9_requested_at?: string | null
        }
        Update: {
          bio?: string | null
          business_type?: string | null
          created_at?: string
          email?: string
          full_name?: string
          homebase_address?: string | null
          homebase_lat?: number | null
          homebase_lng?: number | null
          id?: string
          instagram?: string | null
          is_active?: boolean
          jobs_count?: number
          last_worked_with_at?: string | null
          legal_name?: string | null
          mailing_address?: string | null
          notes?: string | null
          phone?: string | null
          portfolio_url?: string | null
          preferred_max_hourly_rate?: number | null
          preferred_min_hourly_rate?: number | null
          rate_notes?: string | null
          roles?: Database["public"]["Enums"]["contractor_role"][]
          tax_id_type?: string | null
          tax_id_vault_secret_id?: string | null
          updated_at?: string
          w9_collected?: boolean
          w9_collected_at?: string | null
          w9_file_path?: string | null
          w9_original_filename?: string | null
          w9_requested_at?: string | null
        }
        Relationships: []
      }
      contracts: {
        Row: {
          client_id: string | null
          content: string | null
          contract_kind: string
          contractor_id: string | null
          counter_party_email: string | null
          counter_party_name: string | null
          created_at: string
          file_url: string | null
          id: string
          is_block_based: boolean
          public_token: string | null
          public_token_expires_at: string | null
          sent_at: string | null
          signature_data: Json | null
          signature_required_role: string
          signed_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          template_id: string | null
          title: string | null
        }
        Insert: {
          client_id?: string | null
          content?: string | null
          contract_kind?: string
          contractor_id?: string | null
          counter_party_email?: string | null
          counter_party_name?: string | null
          created_at?: string
          file_url?: string | null
          id?: string
          is_block_based?: boolean
          public_token?: string | null
          public_token_expires_at?: string | null
          sent_at?: string | null
          signature_data?: Json | null
          signature_required_role?: string
          signed_at?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          template_id?: string | null
          title?: string | null
        }
        Update: {
          client_id?: string | null
          content?: string | null
          contract_kind?: string
          contractor_id?: string | null
          counter_party_email?: string | null
          counter_party_name?: string | null
          created_at?: string
          file_url?: string | null
          id?: string
          is_block_based?: boolean
          public_token?: string | null
          public_token_expires_at?: string | null
          sent_at?: string | null
          signature_data?: Json | null
          signature_required_role?: string
          signed_at?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          template_id?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "contract_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          email_notifications_enabled: boolean
          id: string
          joined_at: string
          last_read_at: string | null
          role_in_conversation: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          email_notifications_enabled?: boolean
          id?: string
          joined_at?: string
          last_read_at?: string | null
          role_in_conversation: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          email_notifications_enabled?: boolean
          id?: string
          joined_at?: string
          last_read_at?: string | null
          role_in_conversation?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sends: {
        Row: {
          client_id: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          from_address: string
          id: string
          invoice_id: string | null
          metadata: Json | null
          postmark_message_id: string | null
          raw_response: Json | null
          reply_to: string | null
          sent_at: string
          status: string
          subject: string
          tag: string | null
          template_key: string | null
          to_address: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          from_address: string
          id?: string
          invoice_id?: string | null
          metadata?: Json | null
          postmark_message_id?: string | null
          raw_response?: Json | null
          reply_to?: string | null
          sent_at?: string
          status: string
          subject: string
          tag?: string | null
          template_key?: string | null
          to_address: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          from_address?: string
          id?: string
          invoice_id?: string | null
          metadata?: Json | null
          postmark_message_id?: string | null
          raw_response?: Json | null
          reply_to?: string | null
          sent_at?: string
          status?: string
          subject?: string
          tag?: string | null
          template_key?: string | null
          to_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sends_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      email_template_copy: {
        Row: {
          copy: Json
          email_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          copy?: Json
          email_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          copy?: Json
          email_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_template_copy_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          merge_fields: Json | null
          name: string | null
          preview_data: Json | null
          requires_approval: boolean | null
          stage: string | null
          subject: string | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          merge_fields?: Json | null
          name?: string | null
          preview_data?: Json | null
          requires_approval?: boolean | null
          stage?: string | null
          subject?: string | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          merge_fields?: Json | null
          name?: string | null
          preview_data?: Json | null
          requires_approval?: boolean | null
          stage?: string | null
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      engagement_sessions: {
        Row: {
          client_id: string | null
          delivered_at: string | null
          edited_at: string | null
          gallery_url: string | null
          id: string
          location: string | null
          location_notes: string | null
          notes: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["engagement_status"]
        }
        Insert: {
          client_id?: string | null
          delivered_at?: string | null
          edited_at?: string | null
          gallery_url?: string | null
          id?: string
          location?: string | null
          location_notes?: string | null
          notes?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["engagement_status"]
        }
        Update: {
          client_id?: string | null
          delivered_at?: string | null
          edited_at?: string | null
          gallery_url?: string | null
          id?: string
          location?: string | null
          location_notes?: string | null
          notes?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["engagement_status"]
        }
        Relationships: [
          {
            foreignKeyName: "engagement_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      galleries: {
        Row: {
          client_id: string | null
          delivered_at: string | null
          full_gallery_due_date: string | null
          gallery_type: Database["public"]["Enums"]["gallery_type"] | null
          gallery_url: string | null
          id: string
          sneak_peek_delivered_at: string | null
          sneak_peek_due_date: string | null
          view_count: number | null
        }
        Insert: {
          client_id?: string | null
          delivered_at?: string | null
          full_gallery_due_date?: string | null
          gallery_type?: Database["public"]["Enums"]["gallery_type"] | null
          gallery_url?: string | null
          id?: string
          sneak_peek_delivered_at?: string | null
          sneak_peek_due_date?: string | null
          view_count?: number | null
        }
        Update: {
          client_id?: string | null
          delivered_at?: string | null
          full_gallery_due_date?: string | null
          gallery_type?: Database["public"]["Enums"]["gallery_type"] | null
          gallery_url?: string | null
          id?: string
          sneak_peek_delivered_at?: string | null
          sneak_peek_due_date?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "galleries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          amount_cents: number
          created_at: string
          description: string
          id: string
          invoice_id: string
          sequence_order: number
        }
        Insert: {
          amount_cents: number
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          sequence_order?: number
        }
        Update: {
          amount_cents?: number
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          sequence_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_recipients: {
        Row: {
          created_at: string
          email: string
          id: string
          invoice_id: string
          name: string
          role: Database["public"]["Enums"]["invoice_recipient_role"]
          view_token: string
          viewed_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invoice_id: string
          name: string
          role?: Database["public"]["Enums"]["invoice_recipient_role"]
          view_token?: string
          viewed_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invoice_id?: string
          name?: string
          role?: Database["public"]["Enums"]["invoice_recipient_role"]
          view_token?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_recipients_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number | null
          client_id: string | null
          created_at: string
          currency: string
          due_date: string | null
          id: string
          invoice_number: string | null
          invoice_type: Database["public"]["Enums"]["invoice_type"] | null
          label: string | null
          notes: string | null
          paid_at: string | null
          payment_method_last4: string | null
          processing_fee_cents: number
          sent_at: string | null
          sequence_order: number | null
          status: Database["public"]["Enums"]["invoice_status"]
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          subtotal_cents: number | null
          total_cents: number | null
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          amount?: number | null
          client_id?: string | null
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          invoice_type?: Database["public"]["Enums"]["invoice_type"] | null
          label?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_method_last4?: string | null
          processing_fee_cents?: number
          sent_at?: string | null
          sequence_order?: number | null
          status?: Database["public"]["Enums"]["invoice_status"]
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subtotal_cents?: number | null
          total_cents?: number | null
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          amount?: number | null
          client_id?: string | null
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          invoice_type?: Database["public"]["Enums"]["invoice_type"] | null
          label?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_method_last4?: string | null
          processing_fee_cents?: number
          sent_at?: string | null
          sequence_order?: number | null
          status?: Database["public"]["Enums"]["invoice_status"]
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subtotal_cents?: number | null
          total_cents?: number | null
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_bookings: {
        Row: {
          booked_by_email: string | null
          booked_by_user: string | null
          client_id: string | null
          created_at: string
          duration_minutes: number | null
          event_type: Database["public"]["Enums"]["booking_event_type"] | null
          google_event_id: string | null
          id: string
          meeting_link: string | null
          notes: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
        }
        Insert: {
          booked_by_email?: string | null
          booked_by_user?: string | null
          client_id?: string | null
          created_at?: string
          duration_minutes?: number | null
          event_type?: Database["public"]["Enums"]["booking_event_type"] | null
          google_event_id?: string | null
          id?: string
          meeting_link?: string | null
          notes?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
        }
        Update: {
          booked_by_email?: string | null
          booked_by_user?: string | null
          client_id?: string | null
          created_at?: string
          duration_minutes?: number | null
          event_type?: Database["public"]["Enums"]["booking_event_type"] | null
          google_event_id?: string | null
          id?: string
          meeting_link?: string | null
          notes?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
        }
        Relationships: [
          {
            foreignKeyName: "bookings_booked_by_user_fkey"
            columns: ["booked_by_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_invites: {
        Row: {
          call_type_id: string | null
          client_id: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          personal_note: string | null
          prefill: Json
          token: string
          updated_at: string
          used_at: string | null
          used_by_booking_id: string | null
        }
        Insert: {
          call_type_id?: string | null
          client_id: string
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          personal_note?: string | null
          prefill?: Json
          token?: string
          updated_at?: string
          used_at?: string | null
          used_by_booking_id?: string | null
        }
        Update: {
          call_type_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          personal_note?: string | null
          prefill?: Json
          token?: string
          updated_at?: string
          used_at?: string | null
          used_by_booking_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_invites_call_type_id_fkey"
            columns: ["call_type_id"]
            isOneToOne: false
            referencedRelation: "call_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_invites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_invites_used_by_booking_fk"
            columns: ["used_by_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_size_bytes: number | null
          file_url: string
          height: number | null
          id: string
          message_id: string
          mime_type: string | null
          storage_path: string
          thumbnail_url: string | null
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size_bytes?: number | null
          file_url: string
          height?: number | null
          id?: string
          message_id: string
          mime_type?: string | null
          storage_path?: string
          thumbnail_url?: string | null
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size_bytes?: number | null
          file_url?: string
          height?: number | null
          id?: string
          message_id?: string
          mime_type?: string | null
          storage_path?: string
          thumbnail_url?: string | null
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_mentions: {
        Row: {
          created_at: string
          id: string
          mentioned_user_id: string
          message_id: string
          read_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          mentioned_user_id: string
          message_id: string
          read_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          mentioned_user_id?: string
          message_id?: string
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_mentions_mentioned_user_id_fkey"
            columns: ["mentioned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_mentions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reads: {
        Row: {
          id: string
          message_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          id?: string
          message_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          id?: string
          message_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_url: string | null
          content: string | null
          content_tsv: unknown
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          email_message_id: string | null
          id: string
          is_internal_note: boolean
          read_by: Json
          sender_id: string | null
          thread_parent_id: string | null
        }
        Insert: {
          attachment_url?: string | null
          content?: string | null
          content_tsv?: unknown
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          email_message_id?: string | null
          id?: string
          is_internal_note?: boolean
          read_by?: Json
          sender_id?: string | null
          thread_parent_id?: string | null
        }
        Update: {
          attachment_url?: string | null
          content?: string | null
          content_tsv?: unknown
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          email_message_id?: string | null
          id?: string
          is_internal_note?: boolean
          read_by?: Json
          sender_id?: string | null
          thread_parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_thread_parent_id_fkey"
            columns: ["thread_parent_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          link_to: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          link_to?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link_to?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      package_default_inclusions: {
        Row: {
          created_at: string
          id: string
          included_item_id: string
          package_item_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          id?: string
          included_item_id: string
          package_item_id: string
          quantity?: number
        }
        Update: {
          created_at?: string
          id?: string
          included_item_id?: string
          package_item_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "package_default_inclusions_included_item_id_fkey"
            columns: ["included_item_id"]
            isOneToOne: false
            referencedRelation: "service_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_default_inclusions_package_item_id_fkey"
            columns: ["package_item_id"]
            isOneToOne: false
            referencedRelation: "service_items"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          add_processing_fees: boolean
          base_price: number | null
          created_at: string
          default_hours: number | null
          default_payment_schedule_template_id: string | null
          description: string | null
          display_order: number | null
          id: string
          includes_album: boolean | null
          includes_engagement: boolean | null
          includes_second_shooter: boolean | null
          includes_videography: boolean | null
          is_active: boolean | null
          name: string
          updated_at: string
        }
        Insert: {
          add_processing_fees?: boolean
          base_price?: number | null
          created_at?: string
          default_hours?: number | null
          default_payment_schedule_template_id?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          includes_album?: boolean | null
          includes_engagement?: boolean | null
          includes_second_shooter?: boolean | null
          includes_videography?: boolean | null
          is_active?: boolean | null
          name: string
          updated_at?: string
        }
        Update: {
          add_processing_fees?: boolean
          base_price?: number | null
          created_at?: string
          default_hours?: number | null
          default_payment_schedule_template_id?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          includes_album?: boolean | null
          includes_engagement?: boolean | null
          includes_second_shooter?: boolean | null
          includes_videography?: boolean | null
          is_active?: boolean | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packages_default_pst_fk"
            columns: ["default_payment_schedule_template_id"]
            isOneToOne: false
            referencedRelation: "payment_schedule_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          invoice_id: string
          raw_event: Json | null
          status: Database["public"]["Enums"]["payment_attempt_status"]
          stripe_event_id: string | null
          stripe_event_type: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          invoice_id: string
          raw_event?: Json | null
          status: Database["public"]["Enums"]["payment_attempt_status"]
          stripe_event_id?: string | null
          stripe_event_type?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          invoice_id?: string
          raw_event?: Json | null
          status?: Database["public"]["Enums"]["payment_attempt_status"]
          stripe_event_id?: string | null
          stripe_event_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_schedule_template_installments: {
        Row: {
          created_at: string
          due_offset_days: number | null
          due_offset_type: Database["public"]["Enums"]["due_offset_type"]
          id: string
          label: string
          percentage: number
          sequence_order: number
          template_id: string
        }
        Insert: {
          created_at?: string
          due_offset_days?: number | null
          due_offset_type: Database["public"]["Enums"]["due_offset_type"]
          id?: string
          label: string
          percentage: number
          sequence_order: number
          template_id: string
        }
        Update: {
          created_at?: string
          due_offset_days?: number | null
          due_offset_type?: Database["public"]["Enums"]["due_offset_type"]
          id?: string
          label?: string
          percentage?: number
          sequence_order?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_schedule_template_installments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "payment_schedule_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_schedule_templates: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          package_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          package_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          package_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_schedule_templates_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_changes: {
        Row: {
          before_snapshot: Json
          change_type: Database["public"]["Enums"]["pending_change_type"]
          client_id: string
          created_at: string
          id: string
          owner_response_note: string | null
          payload: Json
          projected_after: Json
          proposed_by: string
          proposed_by_role: string
          quote_id: string
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["pending_change_status"]
        }
        Insert: {
          before_snapshot?: Json
          change_type: Database["public"]["Enums"]["pending_change_type"]
          client_id: string
          created_at?: string
          id?: string
          owner_response_note?: string | null
          payload?: Json
          projected_after?: Json
          proposed_by: string
          proposed_by_role: string
          quote_id: string
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["pending_change_status"]
        }
        Update: {
          before_snapshot?: Json
          change_type?: Database["public"]["Enums"]["pending_change_type"]
          client_id?: string
          created_at?: string
          id?: string
          owner_response_note?: string | null
          payload?: Json
          projected_after?: Json
          proposed_by?: string
          proposed_by_role?: string
          quote_id?: string
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["pending_change_status"]
        }
        Relationships: []
      }
      photography_timelines: {
        Row: {
          blocks: Json
          booked_coverage_hours: number | null
          ceremony_address: string | null
          ceremony_length_minutes: number
          ceremony_start_time: string
          client_id: string
          coverage_end_time: string
          coverage_overage_hours: number | null
          coverage_status: string | null
          created_at: string
          dinner_end_time: string | null
          generated_at: string
          generated_coverage_hours: number | null
          generated_from: string
          getting_ready_address: string | null
          golden_hour_start_time: string | null
          group_portrait_minutes: number
          has_extended_dancing: boolean | null
          has_first_look: boolean
          has_jewish_ketubah: boolean | null
          has_wedding_party: boolean | null
          id: string
          manual_overrides: Json | null
          notes_for_photographer: string | null
          questionnaire_response_id: string | null
          reception_address: string | null
          reception_events: Json | null
          sunset_time: string | null
          travel_minutes_ceremony_to_reception: number | null
          travel_minutes_gr_to_ceremony: number | null
          updated_at: string
        }
        Insert: {
          blocks?: Json
          booked_coverage_hours?: number | null
          ceremony_address?: string | null
          ceremony_length_minutes?: number
          ceremony_start_time: string
          client_id: string
          coverage_end_time: string
          coverage_overage_hours?: number | null
          coverage_status?: string | null
          created_at?: string
          dinner_end_time?: string | null
          generated_at?: string
          generated_coverage_hours?: number | null
          generated_from?: string
          getting_ready_address?: string | null
          golden_hour_start_time?: string | null
          group_portrait_minutes?: number
          has_extended_dancing?: boolean | null
          has_first_look?: boolean
          has_jewish_ketubah?: boolean | null
          has_wedding_party?: boolean | null
          id?: string
          manual_overrides?: Json | null
          notes_for_photographer?: string | null
          questionnaire_response_id?: string | null
          reception_address?: string | null
          reception_events?: Json | null
          sunset_time?: string | null
          travel_minutes_ceremony_to_reception?: number | null
          travel_minutes_gr_to_ceremony?: number | null
          updated_at?: string
        }
        Update: {
          blocks?: Json
          booked_coverage_hours?: number | null
          ceremony_address?: string | null
          ceremony_length_minutes?: number
          ceremony_start_time?: string
          client_id?: string
          coverage_end_time?: string
          coverage_overage_hours?: number | null
          coverage_status?: string | null
          created_at?: string
          dinner_end_time?: string | null
          generated_at?: string
          generated_coverage_hours?: number | null
          generated_from?: string
          getting_ready_address?: string | null
          golden_hour_start_time?: string | null
          group_portrait_minutes?: number
          has_extended_dancing?: boolean | null
          has_first_look?: boolean
          has_jewish_ketubah?: boolean | null
          has_wedding_party?: boolean | null
          id?: string
          manual_overrides?: Json | null
          notes_for_photographer?: string | null
          questionnaire_response_id?: string | null
          reception_address?: string | null
          reception_events?: Json | null
          sunset_time?: string | null
          travel_minutes_ceremony_to_reception?: number | null
          travel_minutes_gr_to_ceremony?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "photography_timelines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photography_timelines_questionnaire_response_id_fkey"
            columns: ["questionnaire_response_id"]
            isOneToOne: false
            referencedRelation: "questionnaires"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_invitations: {
        Row: {
          client_id: string
          created_at: string
          expires_at: string
          id: string
          invitation_token: string
          invitation_type: string
          invited_by: string | null
          invited_email: string
          invited_role_in_couple: string | null
          used_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          expires_at: string
          id?: string
          invitation_token: string
          invitation_type: string
          invited_by?: string | null
          invited_email: string
          invited_role_in_couple?: string | null
          used_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          invitation_token?: string
          invitation_type?: string
          invited_by?: string | null
          invited_email?: string
          invited_role_in_couple?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_invitations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portrait_sequences: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          client_id: string
          combined_sequence: Json | null
          couple_comments: string | null
          couple_edits_log: Json
          couple_review_notes: string | null
          created_at: string
          extended_shots: Json | null
          generated_at: string
          generated_from: string
          id: string
          manual_overrides: Json
          notes: string | null
          partner_1_sequence: Json | null
          partner_2_sequence: Json | null
          questionnaire_response_id: string | null
          total_minutes: number | null
          updated_at: string
          wedding_party_shots: Json | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          client_id: string
          combined_sequence?: Json | null
          couple_comments?: string | null
          couple_edits_log?: Json
          couple_review_notes?: string | null
          created_at?: string
          extended_shots?: Json | null
          generated_at?: string
          generated_from?: string
          id?: string
          manual_overrides?: Json
          notes?: string | null
          partner_1_sequence?: Json | null
          partner_2_sequence?: Json | null
          questionnaire_response_id?: string | null
          total_minutes?: number | null
          updated_at?: string
          wedding_party_shots?: Json | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string
          combined_sequence?: Json | null
          couple_comments?: string | null
          couple_edits_log?: Json
          couple_review_notes?: string | null
          created_at?: string
          extended_shots?: Json | null
          generated_at?: string
          generated_from?: string
          id?: string
          manual_overrides?: Json
          notes?: string | null
          partner_1_sequence?: Json | null
          partner_2_sequence?: Json | null
          questionnaire_response_id?: string | null
          total_minutes?: number | null
          updated_at?: string
          wedding_party_shots?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "portrait_sequences_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portrait_sequences_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_fee_settings: {
        Row: {
          id: string
          stripe_flat_cents: number
          stripe_percentage: number
          updated_at: string
        }
        Insert: {
          id?: string
          stripe_flat_cents?: number
          stripe_percentage?: number
          updated_at?: string
        }
        Update: {
          id?: string
          stripe_flat_cents?: number
          stripe_percentage?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      proposals: {
        Row: {
          accepted_at: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          discount: number | null
          id: string
          line_items: Json | null
          package_id: string | null
          personal_note: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["proposal_status"]
          subtotal: number | null
          total: number | null
          valid_until: string | null
          version: number | null
        }
        Insert: {
          accepted_at?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          discount?: number | null
          id?: string
          line_items?: Json | null
          package_id?: string | null
          personal_note?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          subtotal?: number | null
          total?: number | null
          valid_until?: string | null
          version?: number | null
        }
        Update: {
          accepted_at?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          discount?: number | null
          id?: string
          line_items?: Json | null
          package_id?: string | null
          personal_note?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          subtotal?: number | null
          total?: number | null
          valid_until?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "proposals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      questionnaire_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_archived: boolean
          name: string | null
          schema: Json | null
          stage: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_archived?: boolean
          name?: string | null
          schema?: Json | null
          stage?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_archived?: boolean
          name?: string | null
          schema?: Json | null
          stage?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "questionnaire_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      questionnaires: {
        Row: {
          auto_saved_at: string | null
          client_id: string | null
          completed_at: string | null
          due_date: string | null
          id: string
          locked_after_submit: boolean
          reminder_count: number | null
          responses: Json | null
          sent_at: string | null
          status: Database["public"]["Enums"]["questionnaire_status"]
          template_id: string | null
        }
        Insert: {
          auto_saved_at?: string | null
          client_id?: string | null
          completed_at?: string | null
          due_date?: string | null
          id?: string
          locked_after_submit?: boolean
          reminder_count?: number | null
          responses?: Json | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["questionnaire_status"]
          template_id?: string | null
        }
        Update: {
          auto_saved_at?: string | null
          client_id?: string | null
          completed_at?: string | null
          due_date?: string | null
          id?: string
          locked_after_submit?: boolean
          reminder_count?: number | null
          responses?: Json | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["questionnaire_status"]
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "questionnaires_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questionnaires_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "questionnaire_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_item_cost_snapshots: {
        Row: {
          cost_cents_snapshot: number
          created_at: string
          id: string
          quote_item_id: string
        }
        Insert: {
          cost_cents_snapshot?: number
          created_at?: string
          id?: string
          quote_item_id: string
        }
        Update: {
          cost_cents_snapshot?: number
          created_at?: string
          id?: string
          quote_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_item_cost_snapshots_quote_item_id_fkey"
            columns: ["quote_item_id"]
            isOneToOne: true
            referencedRelation: "quote_items"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_item_inclusions: {
        Row: {
          created_at: string
          display_order: number
          id: string
          quote_item_id: string
          text: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          quote_item_id: string
          text: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          quote_item_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_item_inclusions_quote_item_id_fkey"
            columns: ["quote_item_id"]
            isOneToOne: false
            referencedRelation: "quote_items"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_items: {
        Row: {
          created_at: string
          description_snapshot: string
          display_order: number
          id: string
          item_type_snapshot:
            | Database["public"]["Enums"]["service_item_type"]
            | null
          line_total_cents: number
          quantity: number
          quote_id: string
          service_item_id: string | null
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          description_snapshot: string
          display_order?: number
          id?: string
          item_type_snapshot?:
            | Database["public"]["Enums"]["service_item_type"]
            | null
          line_total_cents: number
          quantity?: number
          quote_id: string
          service_item_id?: string | null
          unit_price_cents: number
        }
        Update: {
          created_at?: string
          description_snapshot?: string
          display_order?: number
          id?: string
          item_type_snapshot?:
            | Database["public"]["Enums"]["service_item_type"]
            | null
          line_total_cents?: number
          quantity?: number
          quote_id?: string
          service_item_id?: string | null
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_service_item_id_fkey"
            columns: ["service_item_id"]
            isOneToOne: false
            referencedRelation: "service_items"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          client_id: string
          created_at: string
          discount_cents: number
          escalation_pct_applied: number
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["quote_status"]
          subtotal_cents: number
          total_cents: number
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          accepted_at?: string | null
          client_id: string
          created_at?: string
          discount_cents?: number
          escalation_pct_applied?: number
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          accepted_at?: string | null
          client_id?: string
          created_at?: string
          discount_cents?: number
          escalation_pct_applied?: number
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      reschedule_requests: {
        Row: {
          conversation_message_id: string | null
          created_at: string
          id: string
          invoice_id: string
          original_due_date: string
          proposed_due_date: string
          reason: string | null
          requested_by: Database["public"]["Enums"]["reschedule_requested_by"]
          requested_by_name: string | null
          responded_at: string | null
          responded_by: string | null
          status: Database["public"]["Enums"]["reschedule_status"]
        }
        Insert: {
          conversation_message_id?: string | null
          created_at?: string
          id?: string
          invoice_id: string
          original_due_date: string
          proposed_due_date: string
          reason?: string | null
          requested_by: Database["public"]["Enums"]["reschedule_requested_by"]
          requested_by_name?: string | null
          responded_at?: string | null
          responded_by?: string | null
          status?: Database["public"]["Enums"]["reschedule_status"]
        }
        Update: {
          conversation_message_id?: string | null
          created_at?: string
          id?: string
          invoice_id?: string
          original_due_date?: string
          proposed_due_date?: string
          reason?: string | null
          requested_by?: Database["public"]["Enums"]["reschedule_requested_by"]
          requested_by_name?: string | null
          responded_at?: string | null
          responded_by?: string | null
          status?: Database["public"]["Enums"]["reschedule_status"]
        }
        Relationships: [
          {
            foreignKeyName: "reschedule_requests_conversation_message_id_fkey"
            columns: ["conversation_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reschedule_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          category: Database["public"]["Enums"]["resource_category"] | null
          content: string | null
          content_type:
            | Database["public"]["Enums"]["resource_content_type"]
            | null
          created_at: string
          created_by: string | null
          display_order: number | null
          excerpt: string | null
          external_url: string | null
          featured_image_url: string | null
          file_url: string | null
          id: string
          is_published: boolean | null
          slug: string | null
          surface_in_stages: Json | null
          title: string | null
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["resource_category"] | null
          content?: string | null
          content_type?:
            | Database["public"]["Enums"]["resource_content_type"]
            | null
          created_at?: string
          created_by?: string | null
          display_order?: number | null
          excerpt?: string | null
          external_url?: string | null
          featured_image_url?: string | null
          file_url?: string | null
          id?: string
          is_published?: boolean | null
          slug?: string | null
          surface_in_stages?: Json | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["resource_category"] | null
          content?: string | null
          content_type?:
            | Database["public"]["Enums"]["resource_content_type"]
            | null
          created_at?: string
          created_by?: string | null
          display_order?: number | null
          excerpt?: string | null
          external_url?: string | null
          featured_image_url?: string | null
          file_url?: string | null
          id?: string
          is_published?: boolean | null
          slug?: string | null
          surface_in_stages?: Json | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_communications: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body_draft: string | null
          client_id: string | null
          created_at: string
          email_template_id: string | null
          id: string
          milestone_id: string | null
          recipient_emails: string[] | null
          scheduled_send_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["communication_status"]
          subject: string | null
          workflow_step_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body_draft?: string | null
          client_id?: string | null
          created_at?: string
          email_template_id?: string | null
          id?: string
          milestone_id?: string | null
          recipient_emails?: string[] | null
          scheduled_send_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["communication_status"]
          subject?: string | null
          workflow_step_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body_draft?: string | null
          client_id?: string | null
          created_at?: string
          email_template_id?: string | null
          id?: string
          milestone_id?: string | null
          recipient_emails?: string[] | null
          scheduled_send_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["communication_status"]
          subject?: string | null
          workflow_step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_communications_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_communications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_communications_email_template_id_fkey"
            columns: ["email_template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduling_settings: {
        Row: {
          also_busy_from_calendar_ids: string[]
          buffer_minutes: number
          created_at: string
          id: string
          lookahead_days: number
          min_lead_time_hours: number
          owner_notification_email: string | null
          owner_user_id: string
          primary_calendar_id: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          also_busy_from_calendar_ids?: string[]
          buffer_minutes?: number
          created_at?: string
          id?: string
          lookahead_days?: number
          min_lead_time_hours?: number
          owner_notification_email?: string | null
          owner_user_id: string
          primary_calendar_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          also_busy_from_calendar_ids?: string[]
          buffer_minutes?: number
          created_at?: string
          id?: string
          lookahead_days?: number
          min_lead_time_hours?: number
          owner_notification_email?: string | null
          owner_user_id?: string
          primary_calendar_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_item_costs: {
        Row: {
          cost_cents: number
          cost_notes: string | null
          cost_type: Database["public"]["Enums"]["service_item_unit"]
          created_at: string
          estimated_labor_hours: number | null
          id: string
          service_item_id: string
          updated_at: string
        }
        Insert: {
          cost_cents?: number
          cost_notes?: string | null
          cost_type?: Database["public"]["Enums"]["service_item_unit"]
          created_at?: string
          estimated_labor_hours?: number | null
          id?: string
          service_item_id: string
          updated_at?: string
        }
        Update: {
          cost_cents?: number
          cost_notes?: string | null
          cost_type?: Database["public"]["Enums"]["service_item_unit"]
          created_at?: string
          estimated_labor_hours?: number | null
          id?: string
          service_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_item_costs_service_item_id_fkey"
            columns: ["service_item_id"]
            isOneToOne: true
            referencedRelation: "service_items"
            referencedColumns: ["id"]
          },
        ]
      }
      service_item_inclusions: {
        Row: {
          created_at: string
          display_order: number
          id: string
          service_item_id: string
          text: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          service_item_id: string
          text: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          service_item_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_item_inclusions_service_item_id_fkey"
            columns: ["service_item_id"]
            isOneToOne: false
            referencedRelation: "service_items"
            referencedColumns: ["id"]
          },
        ]
      }
      service_items: {
        Row: {
          coverage_hours: number | null
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          is_taxable: boolean
          item_type: Database["public"]["Enums"]["service_item_type"]
          name: string
          price_cents: number
          unit: Database["public"]["Enums"]["service_item_unit"]
          updated_at: string
        }
        Insert: {
          coverage_hours?: number | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_taxable?: boolean
          item_type: Database["public"]["Enums"]["service_item_type"]
          name: string
          price_cents?: number
          unit?: Database["public"]["Enums"]["service_item_unit"]
          updated_at?: string
        }
        Update: {
          coverage_hours?: number | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_taxable?: boolean
          item_type?: Database["public"]["Enums"]["service_item_type"]
          name?: string
          price_cents?: number
          unit?: Database["public"]["Enums"]["service_item_unit"]
          updated_at?: string
        }
        Relationships: []
      }
      storage_cleanup_queue: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          processed_at: string | null
          reason: string | null
          scheduled_at: string
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          processed_at?: string | null
          reason?: string | null
          scheduled_at: string
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          processed_at?: string | null
          reason?: string | null
          scheduled_at?: string
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      studio_cost_settings: {
        Row: {
          expected_weddings_per_year: number | null
          id: string
          labor_cost_per_hour_cents: number | null
          travel_cost_per_mile_cents: number | null
          updated_at: string
        }
        Insert: {
          expected_weddings_per_year?: number | null
          id?: string
          labor_cost_per_hour_cents?: number | null
          travel_cost_per_mile_cents?: number | null
          updated_at?: string
        }
        Update: {
          expected_weddings_per_year?: number | null
          id?: string
          labor_cost_per_hour_cents?: number | null
          travel_cost_per_mile_cents?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      studio_invoicing_settings: {
        Row: {
          annual_rate_escalation_pct: number
          hourly_coverage_rate_cents: number | null
          id: string
          proposal_validity_days: number
          tbd_deposit_amount_cents: number
          tbd_finalize_window_days: number
          updated_at: string
        }
        Insert: {
          annual_rate_escalation_pct?: number
          hourly_coverage_rate_cents?: number | null
          id?: string
          proposal_validity_days?: number
          tbd_deposit_amount_cents?: number
          tbd_finalize_window_days?: number
          updated_at?: string
        }
        Update: {
          annual_rate_escalation_pct?: number
          hourly_coverage_rate_cents?: number | null
          id?: string
          proposal_validity_days?: number
          tbd_deposit_amount_cents?: number
          tbd_finalize_window_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      studio_overhead_items: {
        Row: {
          amount_cents: number
          cadence: Database["public"]["Enums"]["studio_overhead_cadence"]
          category: string | null
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          label: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          cadence: Database["public"]["Enums"]["studio_overhead_cadence"]
          category?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          label: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          cadence?: Database["public"]["Enums"]["studio_overhead_cadence"]
          category?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      studio_settings: {
        Row: {
          album_credit_expiry_months: number | null
          created_at: string | null
          default_editing_rate: number | null
          ein: string | null
          id: string
          instagram: string | null
          is_active: boolean | null
          overage_hourly_rate: number | null
          photographer_company: string | null
          photographer_name: string | null
          rescheduling_fee_pct: number | null
          studio_address: string | null
          studio_email: string | null
          studio_mailing_address: string | null
          studio_phone: string | null
          updated_at: string | null
          video_cancellation_fee: number | null
          w9_auto_request_enabled: boolean
          website: string | null
        }
        Insert: {
          album_credit_expiry_months?: number | null
          created_at?: string | null
          default_editing_rate?: number | null
          ein?: string | null
          id?: string
          instagram?: string | null
          is_active?: boolean | null
          overage_hourly_rate?: number | null
          photographer_company?: string | null
          photographer_name?: string | null
          rescheduling_fee_pct?: number | null
          studio_address?: string | null
          studio_email?: string | null
          studio_mailing_address?: string | null
          studio_phone?: string | null
          updated_at?: string | null
          video_cancellation_fee?: number | null
          w9_auto_request_enabled?: boolean
          website?: string | null
        }
        Update: {
          album_credit_expiry_months?: number | null
          created_at?: string | null
          default_editing_rate?: number | null
          ein?: string | null
          id?: string
          instagram?: string | null
          is_active?: boolean | null
          overage_hourly_rate?: number | null
          photographer_company?: string | null
          photographer_name?: string | null
          rescheduling_fee_pct?: number | null
          studio_address?: string | null
          studio_email?: string | null
          studio_mailing_address?: string | null
          studio_phone?: string | null
          updated_at?: string | null
          video_cancellation_fee?: number | null
          w9_auto_request_enabled?: boolean
          website?: string | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assignee_id: string | null
          auto_generated: boolean | null
          client_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          milestone_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string | null
        }
        Insert: {
          assignee_id?: string | null
          auto_generated?: boolean | null
          client_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          milestone_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title?: string | null
        }
        Update: {
          assignee_id?: string | null
          auto_generated?: boolean | null
          client_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          milestone_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "timeline_milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      timeline_milestones: {
        Row: {
          action_type: string | null
          client_action_url: string | null
          client_facing_description: string | null
          client_facing_label: string | null
          client_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          is_client_visible: boolean
          is_overridden: boolean
          metadata: Json
          override_reason: string | null
          responsible_party: string | null
          stage: string | null
          status: Database["public"]["Enums"]["milestone_status"]
          title: string | null
          workflow_step_id: string | null
        }
        Insert: {
          action_type?: string | null
          client_action_url?: string | null
          client_facing_description?: string | null
          client_facing_label?: string | null
          client_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          is_client_visible?: boolean
          is_overridden?: boolean
          metadata?: Json
          override_reason?: string | null
          responsible_party?: string | null
          stage?: string | null
          status?: Database["public"]["Enums"]["milestone_status"]
          title?: string | null
          workflow_step_id?: string | null
        }
        Update: {
          action_type?: string | null
          client_action_url?: string | null
          client_facing_description?: string | null
          client_facing_label?: string | null
          client_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          is_client_visible?: boolean
          is_overridden?: boolean
          metadata?: Json
          override_reason?: string | null
          responsible_party?: string | null
          stage?: string | null
          status?: Database["public"]["Enums"]["milestone_status"]
          title?: string | null
          workflow_step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timeline_milestones_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_milestones_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wedding_expenses: {
        Row: {
          amount: number
          category: string | null
          client_id: string
          created_at: string | null
          created_by: string | null
          description: string
          expense_date: string | null
          id: string
        }
        Insert: {
          amount: number
          category?: string | null
          client_id: string
          created_at?: string | null
          created_by?: string | null
          description: string
          expense_date?: string | null
          id?: string
        }
        Update: {
          amount?: number
          category?: string | null
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          description?: string
          expense_date?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_expenses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wedding_expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_team: {
        Row: {
          agreed_hourly_rate: number | null
          agreed_hours: number | null
          agreed_total: number | null
          client_id: string
          contract_id: string | null
          contractor_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["contractor_role"]
        }
        Insert: {
          agreed_hourly_rate?: number | null
          agreed_hours?: number | null
          agreed_total?: number | null
          client_id: string
          contract_id?: string | null
          contractor_id: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["contractor_role"]
        }
        Update: {
          agreed_hourly_rate?: number | null
          agreed_hours?: number | null
          agreed_total?: number | null
          client_id?: string
          contract_id?: string | null
          contractor_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["contractor_role"]
        }
        Relationships: [
          {
            foreignKeyName: "wedding_team_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wedding_team_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wedding_team_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_step_branches: {
        Row: {
          branch_type: Database["public"]["Enums"]["workflow_branch"]
          created_at: string
          id: string
          workflow_step_id: string
        }
        Insert: {
          branch_type: Database["public"]["Enums"]["workflow_branch"]
          created_at?: string
          id?: string
          workflow_step_id: string
        }
        Update: {
          branch_type?: Database["public"]["Enums"]["workflow_branch"]
          created_at?: string
          id?: string
          workflow_step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_step_branches_workflow_step_id_fkey"
            columns: ["workflow_step_id"]
            isOneToOne: false
            referencedRelation: "workflow_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_steps: {
        Row: {
          action_type:
            | Database["public"]["Enums"]["workflow_action_type"]
            | null
          branch_dependency:
            | Database["public"]["Enums"]["workflow_branch"]
            | null
          client_action_url: string | null
          client_facing_description: string | null
          client_facing_label: string | null
          description: string | null
          email_template_id: string | null
          id: string
          is_client_visible: boolean | null
          order_in_stage: number | null
          questionnaire_template_id: string | null
          reminder_offset_days: number | null
          responsible_party:
            | Database["public"]["Enums"]["workflow_responsible"]
            | null
          stage: string | null
          step_number: number | null
          title: string | null
          trigger_event: string | null
          trigger_offset_days: number | null
          trigger_relative_to:
            | Database["public"]["Enums"]["workflow_trigger_relative"]
            | null
          trigger_type:
            | Database["public"]["Enums"]["workflow_trigger_type"]
            | null
          trigger_uses_business_days: boolean
          workflow_template_id: string
        }
        Insert: {
          action_type?:
            | Database["public"]["Enums"]["workflow_action_type"]
            | null
          branch_dependency?:
            | Database["public"]["Enums"]["workflow_branch"]
            | null
          client_action_url?: string | null
          client_facing_description?: string | null
          client_facing_label?: string | null
          description?: string | null
          email_template_id?: string | null
          id?: string
          is_client_visible?: boolean | null
          order_in_stage?: number | null
          questionnaire_template_id?: string | null
          reminder_offset_days?: number | null
          responsible_party?:
            | Database["public"]["Enums"]["workflow_responsible"]
            | null
          stage?: string | null
          step_number?: number | null
          title?: string | null
          trigger_event?: string | null
          trigger_offset_days?: number | null
          trigger_relative_to?:
            | Database["public"]["Enums"]["workflow_trigger_relative"]
            | null
          trigger_type?:
            | Database["public"]["Enums"]["workflow_trigger_type"]
            | null
          trigger_uses_business_days?: boolean
          workflow_template_id: string
        }
        Update: {
          action_type?:
            | Database["public"]["Enums"]["workflow_action_type"]
            | null
          branch_dependency?:
            | Database["public"]["Enums"]["workflow_branch"]
            | null
          client_action_url?: string | null
          client_facing_description?: string | null
          client_facing_label?: string | null
          description?: string | null
          email_template_id?: string | null
          id?: string
          is_client_visible?: boolean | null
          order_in_stage?: number | null
          questionnaire_template_id?: string | null
          reminder_offset_days?: number | null
          responsible_party?:
            | Database["public"]["Enums"]["workflow_responsible"]
            | null
          stage?: string | null
          step_number?: number | null
          title?: string | null
          trigger_event?: string | null
          trigger_offset_days?: number | null
          trigger_relative_to?:
            | Database["public"]["Enums"]["workflow_trigger_relative"]
            | null
          trigger_type?:
            | Database["public"]["Enums"]["workflow_trigger_type"]
            | null
          trigger_uses_business_days?: boolean
          workflow_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_steps_workflow_template_id_fkey"
            columns: ["workflow_template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_templates: {
        Row: {
          created_at: string
          created_by: string | null
          draft_changelog: string | null
          id: string
          is_active: boolean | null
          name: string | null
          parent_version_id: string | null
          published_at: string | null
          published_by: string | null
          status: string
          updated_at: string
          version: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          draft_changelog?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          parent_version_id?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
          version?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          draft_changelog?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          parent_version_id?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_templates_parent_version_id_fkey"
            columns: ["parent_version_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_templates_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      contractor_ytd_pay: {
        Row: {
          contractor_id: string | null
          tax_year: number | null
          total_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wedding_team_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _anchor_date: {
        Args: { p_anchor: string; p_client_id: string; p_step_id?: string }
        Returns: string
      }
      _apply_post_booking_add: {
        Args: {
          p_actor: string
          p_custom_description: string
          p_custom_price_cents: number
          p_display_order: number
          p_quantity: number
          p_quote_id: string
          p_service_item_id: string
        }
        Returns: Json
      }
      _branch_passes: {
        Args: {
          p_branch: Database["public"]["Enums"]["workflow_branch"]
          p_client: Database["public"]["Tables"]["clients"]["Row"]
        }
        Returns: boolean
      }
      _draft_scheduled_communication: {
        Args: { p_milestone_id: string }
        Returns: undefined
      }
      _log_activity: {
        Args: {
          p_action_type: string
          p_description: string
          p_metadata?: Json
          p_target_id: string
          p_target_type: string
          p_user_id?: string
        }
        Returns: undefined
      }
      _notify: {
        Args: {
          p_body?: string
          p_kind: string
          p_link_to?: string
          p_title: string
          p_user_id: string
        }
        Returns: string
      }
      _notify_all_owners: {
        Args: {
          p_body?: string
          p_kind: string
          p_link_to?: string
          p_title: string
        }
        Returns: number
      }
      _preview_post_booking_add: {
        Args: {
          p_custom_description: string
          p_custom_price_cents: number
          p_quantity: number
          p_quote_id: string
          p_service_item_id: string
        }
        Returns: Json
      }
      _snapshot_quote_financials: {
        Args: { p_quote_id: string }
        Returns: Json
      }
      _substitute_merge_fields: {
        Args: { _client_id: string; _text: string }
        Returns: string
      }
      add_business_days: {
        Args: { days_to_add: number; start_date: string }
        Returns: string
      }
      add_quote_item: {
        Args: {
          p_custom_description?: string
          p_custom_price_cents?: number
          p_display_order?: number
          p_quantity?: number
          p_quote_id: string
          p_service_item_id: string
        }
        Returns: Json
      }
      approve_pending_change: {
        Args: { p_force?: boolean; p_id: string }
        Returns: Json
      }
      calculate_production_stage: {
        Args: { _client_id: string }
        Returns: string
      }
      can_manage_contractor_tax_id: { Args: { _uid: string }; Returns: boolean }
      cancel_tbd_booking: {
        Args: { p_client_id: string; p_reason: string }
        Returns: Json
      }
      clear_contractor_tax_id: {
        Args: { _contractor_id: string }
        Returns: undefined
      }
      clear_w9: { Args: { _contractor_id: string }; Returns: string }
      create_booking: {
        Args: {
          p_call_type_id: string
          p_couple_name_1: string
          p_couple_name_2: string
          p_custom_field_responses: Json
          p_idempotency_key?: string
          p_phone: string
          p_primary_email: string
          p_starts_at: string
          p_visitor_timezone: string
        }
        Returns: {
          booking_id: string
          cancel_token: string
          ends_at: string
          starts_at: string
        }[]
      }
      create_booking_invoices: {
        Args: { p_client_id: string; p_overrides?: Json; p_template_id: string }
        Returns: Json
      }
      create_draft_from_published: { Args: never; Returns: string }
      create_tbd_booking: {
        Args: { p_client_id: string; p_deposit_amount_cents: number }
        Returns: Json
      }
      discard_draft: { Args: { _draft_id: string }; Returns: undefined }
      finalize_tbd_booking: {
        Args: {
          p_client_id: string
          p_overrides?: Json
          p_package_id: string
          p_template_id: string
        }
        Returns: Json
      }
      get_booking_by_cancel_token: {
        Args: { p_token: string }
        Returns: {
          booking_id: string
          call_type_name: string
          call_type_slug: string
          cancel_token: string
          couple_name_1: string
          couple_name_2: string
          duration_minutes: number
          ends_at: string
          primary_email: string
          starts_at: string
          status: string
          timezone_snapshot: string
          visitor_timezone: string
          zoom_join_url: string
          zoom_password: string
        }[]
      }
      get_contractor_1099_report: {
        Args: { _tax_year: number }
        Returns: {
          business_type: string
          contractor_id: string
          email: string
          full_name: string
          legal_name: string
          mailing_address: string
          tax_id_on_file: boolean
          tax_id_type: string
          total_cents: number
          w9_collected: boolean
          w9_collected_at: string
          w9_file_path: string
          w9_original_filename: string
          w9_requested_at: string
        }[]
      }
      get_contractor_tax_id: {
        Args: { _contractor_id: string }
        Returns: string
      }
      hard_delete_old_messages: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_assigned_to_client: { Args: { _client_id: string }; Returns: boolean }
      is_associate: { Args: { _user_id: string }; Returns: boolean }
      is_client_of: {
        Args: { _client_id: string; _user_id: string }
        Returns: boolean
      }
      is_owner: { Args: { _user_id: string }; Returns: boolean }
      is_studio_manager: { Args: { _user_id: string }; Returns: boolean }
      is_studio_user: { Args: { _user_id: string }; Returns: boolean }
      mark_w9_collected: {
        Args: { _contractor_id: string; _file_path: string; _filename: string }
        Returns: undefined
      }
      materialize_workflow_for_client: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      preview_publish_impact: { Args: { _draft_id: string }; Returns: Json }
      process_stripe_payment_succeeded: {
        Args: {
          p_amount_total: number
          p_event_id: string
          p_event_type: string
          p_invoice_id: string
          p_payment_method_last4: string
          p_raw_event: Json
          p_stripe_payment_intent_id: string
        }
        Returns: Json
      }
      publish_draft: {
        Args: { _draft_id: string; _migrate_couples?: boolean }
        Returns: Json
      }
      recalculate_milestones_for_client: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      reject_pending_change: {
        Args: { p_id: string; p_note?: string }
        Returns: Json
      }
      save_contractor_w9_info: {
        Args: {
          _business_type: string
          _contractor_id: string
          _legal_name: string
          _mailing_address: string
        }
        Returns: undefined
      }
      set_contractor_tax_id: {
        Args: { _contractor_id: string; _plaintext: string; _type: string }
        Returns: undefined
      }
      trigger_event_handler: {
        Args: {
          p_client_id: string
          p_event_metadata?: Json
          p_event_name: string
        }
        Returns: undefined
      }
    }
    Enums: {
      album_status:
        | "pending_questionnaire"
        | "designing"
        | "proofing"
        | "approved"
        | "printing"
        | "shipped"
        | "delivered"
      app_role: "owner" | "studio_manager" | "associate_photographer" | "client"
      availability_event_type:
        | "discovery_call"
        | "timeline_review"
        | "engagement_session_consultation"
        | "custom"
      booking_cancelled_by: "couple" | "owner" | "system"
      booking_event_type:
        | "discovery_call"
        | "timeline_review"
        | "engagement_consultation"
      booking_reminder_kind:
        | "confirmation"
        | "reminder_24h"
        | "reminder_1h"
        | "owner_notification"
        | "cancelled"
        | "rescheduled"
      booking_reminder_status:
        | "pending"
        | "sent"
        | "failed"
        | "skipped"
        | "cancelled"
      booking_source: "public" | "manual_invite"
      booking_status: "confirmed" | "cancelled" | "completed" | "no_show"
      calendar_provider: "google" | "zoom"
      call_location_type: "zoom"
      call_type_field_type:
        | "text"
        | "textarea"
        | "email"
        | "date"
        | "dropdown"
        | "checkbox"
      client_status:
        | "lead"
        | "booked"
        | "active"
        | "delivered"
        | "complete"
        | "archived"
      communication_status:
        | "drafted"
        | "awaiting_approval"
        | "approved"
        | "sent"
        | "skipped"
        | "edited"
      contract_block_type:
        | "text_box"
        | "image"
        | "divider"
        | "spacer"
        | "short_answer"
        | "free_response"
        | "date_select"
        | "initials"
        | "signature"
        | "dropdown"
        | "checkboxes"
        | "multiple_choice"
      contract_status: "draft" | "sent" | "signed"
      contractor_role:
        | "second_shooter"
        | "associate_photographer"
        | "videographer"
        | "second_videographer"
        | "photo_assistant"
      due_offset_type: "days_after_booking" | "days_before_event" | "on_booking"
      engagement_status:
        | "pending_scheduling"
        | "scheduled"
        | "complete"
        | "delivered"
      gallery_type: "engagement" | "wedding"
      invoice_recipient_role:
        | "primary_client"
        | "partner"
        | "planner"
        | "parent"
        | "other"
      invoice_status:
        | "draft"
        | "sent"
        | "paid"
        | "overdue"
        | "scheduled"
        | "viewed"
        | "reschedule_requested"
        | "cancelled"
        | "refunded"
        | "kill_fee"
      invoice_type:
        | "retainer"
        | "final"
        | "album"
        | "other"
        | "installment"
        | "date_hold_deposit"
        | "kill_fee"
      milestone_status: "upcoming" | "in_progress" | "complete" | "skipped"
      payment_attempt_status:
        | "succeeded"
        | "failed"
        | "refunded"
        | "disputed"
        | "mismatch"
      pending_change_status: "pending" | "approved" | "rejected" | "cancelled"
      pending_change_type:
        | "post_booking_add"
        | "post_booking_edit"
        | "post_booking_remove"
        | "post_booking_discount"
      proposal_status: "draft" | "sent" | "accepted" | "expired" | "revised"
      questionnaire_status: "not_started" | "in_progress" | "complete"
      quote_status: "draft" | "sent" | "accepted" | "expired"
      reschedule_requested_by: "client" | "studio"
      reschedule_status: "pending" | "approved" | "denied" | "cancelled"
      resource_category:
        | "engagement_session"
        | "wedding_prep"
        | "albums_prints"
        | "faq"
        | "style_guides"
        | "travel_lodging"
        | "general"
      resource_content_type: "article" | "pdf" | "video" | "link"
      service_item_type:
        | "wedding_package"
        | "engagement_session"
        | "portrait_session"
        | "album"
        | "videography"
        | "print"
        | "add_on"
        | "deliverable"
        | "travel"
        | "custom"
      service_item_unit:
        | "flat"
        | "per_hour"
        | "per_mile"
        | "per_person"
        | "per_unit"
      service_request_status:
        | "sent"
        | "accepted"
        | "declined"
        | "no_response"
        | "cancelled"
        | "booked"
      studio_overhead_cadence: "monthly" | "annual"
      task_priority: "low" | "normal" | "high"
      task_status: "pending" | "complete" | "skipped"
      workflow_action_type:
        | "create_task"
        | "draft_email"
        | "show_portal_item"
        | "send_questionnaire"
        | "send_invoice"
        | "status_change"
        | "reminder"
        | "system_event"
      workflow_branch:
        | "always"
        | "has_engagement"
        | "has_videography"
        | "has_album"
        | "has_album_active"
        | "NOT_has_album_purchased"
      workflow_responsible:
        | "system"
        | "owner"
        | "manager"
        | "associate"
        | "client"
      workflow_trigger_relative:
        | "wedding_date"
        | "booking_date"
        | "engagement_session_date"
        | "gallery_delivery_date"
        | "previous_step"
        | "proposal_valid_until"
        | "album_workflow_activated_at"
      workflow_trigger_type: "relative_date" | "event" | "manual"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      album_status: [
        "pending_questionnaire",
        "designing",
        "proofing",
        "approved",
        "printing",
        "shipped",
        "delivered",
      ],
      app_role: ["owner", "studio_manager", "associate_photographer", "client"],
      availability_event_type: [
        "discovery_call",
        "timeline_review",
        "engagement_session_consultation",
        "custom",
      ],
      booking_cancelled_by: ["couple", "owner", "system"],
      booking_event_type: [
        "discovery_call",
        "timeline_review",
        "engagement_consultation",
      ],
      booking_reminder_kind: [
        "confirmation",
        "reminder_24h",
        "reminder_1h",
        "owner_notification",
        "cancelled",
        "rescheduled",
      ],
      booking_reminder_status: [
        "pending",
        "sent",
        "failed",
        "skipped",
        "cancelled",
      ],
      booking_source: ["public", "manual_invite"],
      booking_status: ["confirmed", "cancelled", "completed", "no_show"],
      calendar_provider: ["google", "zoom"],
      call_location_type: ["zoom"],
      call_type_field_type: [
        "text",
        "textarea",
        "email",
        "date",
        "dropdown",
        "checkbox",
      ],
      client_status: [
        "lead",
        "booked",
        "active",
        "delivered",
        "complete",
        "archived",
      ],
      communication_status: [
        "drafted",
        "awaiting_approval",
        "approved",
        "sent",
        "skipped",
        "edited",
      ],
      contract_block_type: [
        "text_box",
        "image",
        "divider",
        "spacer",
        "short_answer",
        "free_response",
        "date_select",
        "initials",
        "signature",
        "dropdown",
        "checkboxes",
        "multiple_choice",
      ],
      contract_status: ["draft", "sent", "signed"],
      contractor_role: [
        "second_shooter",
        "associate_photographer",
        "videographer",
        "second_videographer",
        "photo_assistant",
      ],
      due_offset_type: [
        "days_after_booking",
        "days_before_event",
        "on_booking",
      ],
      engagement_status: [
        "pending_scheduling",
        "scheduled",
        "complete",
        "delivered",
      ],
      gallery_type: ["engagement", "wedding"],
      invoice_recipient_role: [
        "primary_client",
        "partner",
        "planner",
        "parent",
        "other",
      ],
      invoice_status: [
        "draft",
        "sent",
        "paid",
        "overdue",
        "scheduled",
        "viewed",
        "reschedule_requested",
        "cancelled",
        "refunded",
        "kill_fee",
      ],
      invoice_type: [
        "retainer",
        "final",
        "album",
        "other",
        "installment",
        "date_hold_deposit",
        "kill_fee",
      ],
      milestone_status: ["upcoming", "in_progress", "complete", "skipped"],
      payment_attempt_status: [
        "succeeded",
        "failed",
        "refunded",
        "disputed",
        "mismatch",
      ],
      pending_change_status: ["pending", "approved", "rejected", "cancelled"],
      pending_change_type: [
        "post_booking_add",
        "post_booking_edit",
        "post_booking_remove",
        "post_booking_discount",
      ],
      proposal_status: ["draft", "sent", "accepted", "expired", "revised"],
      questionnaire_status: ["not_started", "in_progress", "complete"],
      quote_status: ["draft", "sent", "accepted", "expired"],
      reschedule_requested_by: ["client", "studio"],
      reschedule_status: ["pending", "approved", "denied", "cancelled"],
      resource_category: [
        "engagement_session",
        "wedding_prep",
        "albums_prints",
        "faq",
        "style_guides",
        "travel_lodging",
        "general",
      ],
      resource_content_type: ["article", "pdf", "video", "link"],
      service_item_type: [
        "wedding_package",
        "engagement_session",
        "portrait_session",
        "album",
        "videography",
        "print",
        "add_on",
        "deliverable",
        "travel",
        "custom",
      ],
      service_item_unit: [
        "flat",
        "per_hour",
        "per_mile",
        "per_person",
        "per_unit",
      ],
      service_request_status: [
        "sent",
        "accepted",
        "declined",
        "no_response",
        "cancelled",
        "booked",
      ],
      studio_overhead_cadence: ["monthly", "annual"],
      task_priority: ["low", "normal", "high"],
      task_status: ["pending", "complete", "skipped"],
      workflow_action_type: [
        "create_task",
        "draft_email",
        "show_portal_item",
        "send_questionnaire",
        "send_invoice",
        "status_change",
        "reminder",
        "system_event",
      ],
      workflow_branch: [
        "always",
        "has_engagement",
        "has_videography",
        "has_album",
        "has_album_active",
        "NOT_has_album_purchased",
      ],
      workflow_responsible: [
        "system",
        "owner",
        "manager",
        "associate",
        "client",
      ],
      workflow_trigger_relative: [
        "wedding_date",
        "booking_date",
        "engagement_session_date",
        "gallery_delivery_date",
        "previous_step",
        "proposal_valid_until",
        "album_workflow_activated_at",
      ],
      workflow_trigger_type: ["relative_date", "event", "manual"],
    },
  },
} as const
