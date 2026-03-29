#[cfg(target_os = "windows")]
fn main() {
    let mut resource = winres::WindowsResource::new();
    resource.set_icon("assets/timeline.ico");
    resource
        .compile()
        .expect("failed to compile Windows icon resources");
}

#[cfg(not(target_os = "windows"))]
fn main() {}
