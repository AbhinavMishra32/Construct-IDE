use tauri::{Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub fn create_main_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
    initialization_script: &str,
) -> tauri::Result<WebviewWindow<R>> {
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Construct")
        .inner_size(1180.0, 780.0)
        .min_inner_size(860.0, 560.0)
        .resizable(true)
        .initialization_script(initialization_script);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            // Centred in the 44px titlebar row the renderer reserves through
            // `--titlebar-height`: 16px buttons in a 44px row leave 14px above.
            // Keep the two in step — the row is what the buttons are measured
            // against, and moving one without the other lands them off-centre.
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 14.0))
            .transparent(true);
    }
    #[cfg(target_os = "windows")]
    {
        builder = builder.decorations(false).transparent(false);
    }

    let window = builder.build()?;
    apply_native_material(&window);
    Ok(window)
}

fn apply_native_material<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        let _ = apply_vibrancy(
            window,
            NSVisualEffectMaterial::Sidebar,
            Some(NSVisualEffectState::Active),
            None,
        );
    }
    #[cfg(target_os = "windows")]
    {
        let _ = window_vibrancy::apply_acrylic(window, Some((0, 0, 0, 0)));
    }
    let _ = window;
}
