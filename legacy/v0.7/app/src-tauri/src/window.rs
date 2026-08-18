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
            // `--titlebar-height`. Keep the two in step — the row is what the
            // buttons are measured against, and moving one without the other
            // lands them off-centre.
            //
            // The y is NOT the gap above the buttons. tao resizes the standard
            // title-bar container to `button_height + y` and leaves each button
            // where it already sat inside it, so what lands on screen is
            // `y - button_offset` — and on macOS 26 the buttons are 14x14 sitting
            // 9px in from the top of a 32px container. Centring 14px in a 44px
            // row wants a 15px inset, so y = 15 + 9. Read as a top gap this looks
            // 10px too large; it is not, and shrinking it rides the buttons back
            // up above the wordmark beside them.
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 24.0))
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
