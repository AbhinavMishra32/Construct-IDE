diesel::table! {
    storage_items (scope, key) {
        scope -> Text,
        key -> Text,
        value -> Text,
        target -> Integer,
        updated_at -> Text,
    }
}

diesel::table! {
    storage_sync_queue (id) {
        id -> Text,
        provider_id -> Text,
        scope -> Text,
        key -> Text,
        operation -> Text,
        target -> Nullable<Integer>,
        status -> Text,
        created_at -> Text,
        flushed_at -> Nullable<Text>,
    }
}

diesel::table! {
    construct_projects (id) {
        id -> Text,
        kind -> Text,
        title -> Text,
        description -> Text,
        progress -> Integer,
        last_opened_at -> Nullable<Text>,
        workspace_path -> Text,
        active_file_path -> Nullable<Text>,
        file_tree_expanded_json -> Text,
        completed_at -> Nullable<Text>,
        source_path -> Nullable<Text>,
        source -> Nullable<Text>,
        original_source -> Nullable<Text>,
        authoring_fixes_json -> Nullable<Text>,
        program_json -> Nullable<Text>,
        current_step_index -> Nullable<Integer>,
        current_block_index -> Nullable<Integer>,
        typing_progress_json -> Nullable<Text>,
        edit_anchors_json -> Nullable<Text>,
        assistance_json -> Nullable<Text>,
        verification_results_json -> Nullable<Text>,
        completed_blocks_json -> Nullable<Text>,
        flow_goal -> Nullable<Text>,
        flow_stack_preference -> Nullable<Text>,
        flow_autonomy_preference -> Nullable<Text>,
        flow_permissions_preference -> Nullable<Text>,
        flow_project_settings_json -> Nullable<Text>,
        flow_memory_directory -> Nullable<Text>,
        flow_thread_id -> Nullable<Text>,
        flow_research_enabled -> Nullable<Integer>,
        flow_research_completed_at -> Nullable<Text>,
        flow_current_path_node_id -> Nullable<Text>,
        flow_path_created_at -> Nullable<Text>,
        flow_path_updated_at -> Nullable<Text>,
        flow_created_at -> Nullable<Text>,
        flow_updated_at -> Nullable<Text>,
        created_at -> Text,
        updated_at -> Text,
    }
}
