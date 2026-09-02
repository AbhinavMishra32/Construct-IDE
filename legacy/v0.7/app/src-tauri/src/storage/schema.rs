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
    construct_project_documents (project_id) {
        project_id -> Text,
        payload_json -> Text,
        updated_at -> Text,
    }
}

diesel::table! {
    construct_flow_path_nodes (id) {
        id -> Text, original_id -> Nullable<Text>, project_id -> Text, title -> Text, summary -> Text,
        status -> Text, node_order -> Integer, kind -> Nullable<Text>, learner_level -> Nullable<Text>,
        concepts_json -> Nullable<Text>, task_ids_json -> Nullable<Text>, entry_criteria_json -> Nullable<Text>,
        exit_criteria_json -> Nullable<Text>, research_notes_json -> Nullable<Text>, created_at -> Text,
        updated_at -> Text, completed_at -> Nullable<Text>,
    }
}

diesel::table! {
    construct_flow_sessions (id) {
        id -> Text, project_id -> Text, thread_id -> Text, origin -> Nullable<Text>,
        question_response_json -> Nullable<Text>, status -> Text, citations_json -> Nullable<Text>,
        context_compaction_json -> Nullable<Text>, context_window_json -> Nullable<Text>, created_at -> Text,
        updated_at -> Text, duration_ms -> Nullable<Integer>, step_count -> Nullable<Integer>,
        finish_reason -> Nullable<Text>, error_message -> Nullable<Text>,
    }
}

diesel::table! {
    construct_flow_messages (id) {
        id -> Text, original_id -> Nullable<Text>, project_id -> Text, session_id -> Text,
        role -> Text, content -> Text, created_at -> Text, position -> Integer,
    }
}

diesel::table! {
    construct_flow_tool_calls (id) {
        id -> Text, original_id -> Nullable<Text>, project_id -> Text, session_id -> Text,
        name -> Text, title -> Text, reason -> Text, input_json -> Nullable<Text>, output_preview -> Nullable<Text>,
        response_json -> Nullable<Text>, status -> Text, created_at -> Text, completed_at -> Nullable<Text>, position -> Integer,
    }
}

diesel::table! {
    construct_flow_timeline_parts (id) {
        id -> Text, original_id -> Nullable<Text>, project_id -> Text, session_id -> Text, kind -> Text,
        status -> Text, title -> Nullable<Text>, detail -> Nullable<Text>, text -> Nullable<Text>,
        tool_call_id -> Nullable<Text>, name -> Nullable<Text>, reason -> Nullable<Text>, input_json -> Nullable<Text>,
        output_preview -> Nullable<Text>, summary -> Nullable<Text>, before_tokens -> Nullable<Integer>,
        after_tokens -> Nullable<Integer>, summarized_message_count -> Nullable<Integer>,
        preserved_message_count -> Nullable<Integer>, created_at -> Text, completed_at -> Nullable<Text>,
        updated_at -> Nullable<Text>, position -> Integer,
    }
}

diesel::table! {
    construct_flow_agent_events (id) {
        id -> Text, project_id -> Text, session_id -> Text, payload_json -> Text, position -> Integer,
    }
}

diesel::table! {
    construct_flow_actions (id) {
        id -> Text, project_id -> Text, session_id -> Text, payload_json -> Text, position -> Integer,
    }
}

diesel::table! {
    construct_flow_practice_tasks (id) {
        id -> Text, original_id -> Nullable<Text>, project_id -> Text, session_id -> Text,
        path_node_id -> Nullable<Text>, language -> Nullable<Text>, title -> Text, prompt -> Text,
        status -> Text, created_at -> Text, submitted_at -> Nullable<Text>, payload_json -> Text, position -> Integer,
    }
}

diesel::table! {
    construct_flow_concept_exercises (id) {
        id -> Text, original_id -> Nullable<Text>, project_id -> Text, session_id -> Text,
        title -> Text, status -> Text, created_at -> Text, payload_json -> Text, position -> Integer,
    }
}

diesel::table! { construct_learning_meta (key) { key -> Text, value -> Text, } }
diesel::table! { construct_learning_global_concepts (concept_id) { concept_id -> Text, payload_json -> Text, } }
diesel::table! { construct_learning_assistance_events (id) { id -> Text, project_id -> Nullable<Text>, kind -> Text, created_at -> Text, payload_json -> Text, } }
diesel::table! { construct_learning_projects (project_id) { project_id -> Text, current_step_index -> Nullable<Integer>, current_block_index -> Nullable<Integer>, current_block_id -> Nullable<Text>, } }
diesel::table! { construct_project_concept_understanding (project_id, concept_id) { project_id -> Text, concept_id -> Text, payload_json -> Text, } }
diesel::table! { construct_project_concept_relations (project_id, concept_id) { project_id -> Text, concept_id -> Text, last_referenced_at -> Nullable<Text>, payload_json -> Text, } }
diesel::table! { construct_project_concept_events (id) { id -> Text, project_id -> Text, concept_id -> Text, created_at -> Text, payload_json -> Text, } }
diesel::table! { construct_project_artifact_audits (id) { id -> Text, project_id -> Text, created_at -> Text, payload_json -> Text, } }
diesel::table! { construct_knowledge_concepts (project_id, concept_id) { project_id -> Text, concept_id -> Text, title -> Text, kind -> Text, language -> Nullable<Text>, technology -> Nullable<Text>, saved_at -> Nullable<Text>, updated_at -> Nullable<Text>, payload_json -> Text, } }
diesel::table! { construct_project_concept_engagement (project_id, concept_id) { project_id -> Text, concept_id -> Text, first_opened_at -> Text, last_opened_at -> Text, open_count -> Integer, } }
diesel::table! { construct_project_interact_sessions (id) { id -> Text, project_id -> Text, created_at -> Text, updated_at -> Nullable<Text>, payload_json -> Text, } }
diesel::table! { construct_project_recall_attempts (id) { id -> Text, project_id -> Text, created_at -> Text, payload_json -> Text, } }
diesel::table! { construct_project_planned_overlays (id) { id -> Text, project_id -> Text, payload_json -> Text, } }
diesel::table! { construct_project_generated_live_steps (id) { id -> Text, project_id -> Text, status -> Text, created_at -> Text, updated_at -> Nullable<Text>, payload_json -> Text, } }
diesel::table! { construct_project_generated_live_step_runs (id) { id -> Text, project_id -> Text, created_at -> Text, payload_json -> Text, } }
diesel::table! { construct_learning_documents (singleton) { singleton -> Integer, payload_json -> Text, updated_at -> Text, } }

diesel::joinable!(construct_project_documents -> construct_projects (project_id));
diesel::joinable!(construct_flow_path_nodes -> construct_projects (project_id));
diesel::joinable!(construct_flow_sessions -> construct_projects (project_id));
diesel::joinable!(construct_flow_messages -> construct_flow_sessions (session_id));
diesel::joinable!(construct_flow_tool_calls -> construct_flow_sessions (session_id));
diesel::joinable!(construct_flow_timeline_parts -> construct_flow_sessions (session_id));
diesel::joinable!(construct_flow_agent_events -> construct_flow_sessions (session_id));
diesel::joinable!(construct_flow_actions -> construct_flow_sessions (session_id));
diesel::joinable!(construct_flow_practice_tasks -> construct_flow_sessions (session_id));
diesel::joinable!(construct_flow_concept_exercises -> construct_flow_sessions (session_id));

diesel::allow_tables_to_appear_in_same_query!(
    construct_projects,
    construct_project_documents,
    construct_flow_path_nodes,
    construct_flow_sessions,
    construct_flow_messages,
    construct_flow_tool_calls,
    construct_flow_timeline_parts,
    construct_flow_agent_events,
    construct_flow_actions,
    construct_flow_practice_tasks,
    construct_flow_concept_exercises,
    storage_items,
    storage_sync_queue,
    construct_learning_meta,
    construct_learning_global_concepts,
    construct_learning_assistance_events,
    construct_learning_projects,
    construct_project_concept_understanding,
    construct_project_concept_relations,
    construct_project_concept_events,
    construct_project_artifact_audits,
    construct_knowledge_concepts,
    construct_project_concept_engagement,
    construct_project_interact_sessions,
    construct_project_recall_attempts,
    construct_project_planned_overlays,
    construct_project_generated_live_steps,
    construct_project_generated_live_step_runs,
    construct_learning_documents,
);

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
