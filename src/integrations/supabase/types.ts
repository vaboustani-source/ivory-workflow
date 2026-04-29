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
          created_at: string
          description: string | null
          id: string
          metadata: Json | null
          target_id: string | null
          target_type: string | null
          user_id: string | null
        }
        Insert: {
          action_type?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Update: {
          action_type?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Relationships: [
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
      bookings: {
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
          calendar_id: string | null
          created_at: string
          id: string
          is_active: boolean | null
          last_synced_at: string | null
          provider: Database["public"]["Enums"]["calendar_provider"] | null
          refresh_token: string | null
          user_id: string | null
        }
        Insert: {
          access_token?: string | null
          calendar_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          provider?: Database["public"]["Enums"]["calendar_provider"] | null
          refresh_token?: string | null
          user_id?: string | null
        }
        Update: {
          access_token?: string | null
          calendar_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          provider?: Database["public"]["Enums"]["calendar_provider"] | null
          refresh_token?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          booked_at: string | null
          couple_name_1: string
          couple_name_2: string | null
          created_at: string
          guest_count: number | null
          has_album: boolean | null
          has_engagement: boolean | null
          has_videography: boolean | null
          id: string
          inquiry_source: string | null
          last_contacted_at: string | null
          manager_id: string | null
          notes: string | null
          package_id: string | null
          package_price: number | null
          phone: string | null
          photographer_id: string | null
          portal_first_login_at: string | null
          portal_invited_at: string | null
          portal_login_mode: string | null
          primary_email: string
          production_stage_override: string | null
          production_stage_override_at: string | null
          production_stage_override_by: string | null
          secondary_email: string | null
          status: Database["public"]["Enums"]["client_status"]
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
          booked_at?: string | null
          couple_name_1: string
          couple_name_2?: string | null
          created_at?: string
          guest_count?: number | null
          has_album?: boolean | null
          has_engagement?: boolean | null
          has_videography?: boolean | null
          id?: string
          inquiry_source?: string | null
          last_contacted_at?: string | null
          manager_id?: string | null
          notes?: string | null
          package_id?: string | null
          package_price?: number | null
          phone?: string | null
          photographer_id?: string | null
          portal_first_login_at?: string | null
          portal_invited_at?: string | null
          portal_login_mode?: string | null
          primary_email: string
          production_stage_override?: string | null
          production_stage_override_at?: string | null
          production_stage_override_by?: string | null
          secondary_email?: string | null
          status?: Database["public"]["Enums"]["client_status"]
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
          booked_at?: string | null
          couple_name_1?: string
          couple_name_2?: string | null
          created_at?: string
          guest_count?: number | null
          has_album?: boolean | null
          has_engagement?: boolean | null
          has_videography?: boolean | null
          id?: string
          inquiry_source?: string | null
          last_contacted_at?: string | null
          manager_id?: string | null
          notes?: string | null
          package_id?: string | null
          package_price?: number | null
          phone?: string | null
          photographer_id?: string | null
          portal_first_login_at?: string | null
          portal_invited_at?: string | null
          portal_login_mode?: string | null
          primary_email?: string
          production_stage_override?: string | null
          production_stage_override_at?: string | null
          production_stage_override_by?: string | null
          secondary_email?: string | null
          status?: Database["public"]["Enums"]["client_status"]
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
        ]
      }
      contracts: {
        Row: {
          client_id: string | null
          created_at: string
          file_url: string | null
          id: string
          sent_at: string | null
          signature_data: Json | null
          signed_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          title: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          file_url?: string | null
          id?: string
          sent_at?: string | null
          signature_data?: Json | null
          signed_at?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          title?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          file_url?: string | null
          id?: string
          sent_at?: string | null
          signature_data?: Json | null
          signed_at?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
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
      invoices: {
        Row: {
          amount: number | null
          client_id: string | null
          created_at: string
          due_date: string | null
          id: string
          invoice_number: string | null
          invoice_type: Database["public"]["Enums"]["invoice_type"] | null
          paid_at: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          stripe_payment_intent_id: string | null
        }
        Insert: {
          amount?: number | null
          client_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          invoice_type?: Database["public"]["Enums"]["invoice_type"] | null
          paid_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          stripe_payment_intent_id?: string | null
        }
        Update: {
          amount?: number | null
          client_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          invoice_type?: Database["public"]["Enums"]["invoice_type"] | null
          paid_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          stripe_payment_intent_id?: string | null
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
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          is_internal_note: boolean
          read_by: Json
          sender_id: string | null
          thread_parent_id: string | null
        }
        Insert: {
          attachment_url?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          is_internal_note?: boolean
          read_by?: Json
          sender_id?: string | null
          thread_parent_id?: string | null
        }
        Update: {
          attachment_url?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
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
      packages: {
        Row: {
          base_price: number | null
          created_at: string
          default_hours: number | null
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
          base_price?: number | null
          created_at?: string
          default_hours?: number | null
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
          base_price?: number | null
          created_at?: string
          default_hours?: number | null
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
        Relationships: []
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
          description: string | null
          id: string
          is_active: boolean | null
          name: string | null
          schema: Json | null
          stage: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          schema?: Json | null
          stage?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          schema?: Json | null
          stage?: string | null
        }
        Relationships: []
      }
      questionnaires: {
        Row: {
          client_id: string | null
          completed_at: string | null
          due_date: string | null
          id: string
          reminder_count: number | null
          responses: Json | null
          sent_at: string | null
          status: Database["public"]["Enums"]["questionnaire_status"]
          template_id: string | null
        }
        Insert: {
          client_id?: string | null
          completed_at?: string | null
          due_date?: string | null
          id?: string
          reminder_count?: number | null
          responses?: Json | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["questionnaire_status"]
          template_id?: string | null
        }
        Update: {
          client_id?: string | null
          completed_at?: string | null
          due_date?: string | null
          id?: string
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
      [_ in never]: never
    }
    Functions: {
      _anchor_date: {
        Args: { p_anchor: string; p_client_id: string; p_step_id?: string }
        Returns: string
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
      _substitute_merge_fields: {
        Args: { _client_id: string; _text: string }
        Returns: string
      }
      add_business_days: {
        Args: { days_to_add: number; start_date: string }
        Returns: string
      }
      calculate_production_stage: {
        Args: { _client_id: string }
        Returns: string
      }
      create_draft_from_published: { Args: never; Returns: string }
      discard_draft: { Args: { _draft_id: string }; Returns: undefined }
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
      materialize_workflow_for_client: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      preview_publish_impact: { Args: { _draft_id: string }; Returns: Json }
      publish_draft: {
        Args: { _draft_id: string; _migrate_couples?: boolean }
        Returns: Json
      }
      recalculate_milestones_for_client: {
        Args: { p_client_id: string }
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
      booking_event_type:
        | "discovery_call"
        | "timeline_review"
        | "engagement_consultation"
      booking_status: "confirmed" | "cancelled" | "completed" | "no_show"
      calendar_provider: "google"
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
      contract_status: "draft" | "sent" | "signed"
      engagement_status:
        | "pending_scheduling"
        | "scheduled"
        | "complete"
        | "delivered"
      gallery_type: "engagement" | "wedding"
      invoice_status: "draft" | "sent" | "paid" | "overdue"
      invoice_type: "retainer" | "final" | "album" | "other"
      milestone_status: "upcoming" | "in_progress" | "complete" | "skipped"
      proposal_status: "draft" | "sent" | "accepted" | "expired" | "revised"
      questionnaire_status: "not_started" | "in_progress" | "complete"
      resource_category:
        | "engagement_session"
        | "wedding_prep"
        | "albums_prints"
        | "faq"
        | "style_guides"
        | "travel_lodging"
        | "general"
      resource_content_type: "article" | "pdf" | "video" | "link"
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
      booking_event_type: [
        "discovery_call",
        "timeline_review",
        "engagement_consultation",
      ],
      booking_status: ["confirmed", "cancelled", "completed", "no_show"],
      calendar_provider: ["google"],
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
      contract_status: ["draft", "sent", "signed"],
      engagement_status: [
        "pending_scheduling",
        "scheduled",
        "complete",
        "delivered",
      ],
      gallery_type: ["engagement", "wedding"],
      invoice_status: ["draft", "sent", "paid", "overdue"],
      invoice_type: ["retainer", "final", "album", "other"],
      milestone_status: ["upcoming", "in_progress", "complete", "skipped"],
      proposal_status: ["draft", "sent", "accepted", "expired", "revised"],
      questionnaire_status: ["not_started", "in_progress", "complete"],
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
