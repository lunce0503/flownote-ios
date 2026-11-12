Pod::Spec.new do |s|
  s.name = 'ApplePencilEvents'
  s.version = '1.0.0'
  s.summary = 'Flownote Apple Pencil interaction events'
  s.description = 'Fixed native Apple Pencil double-tap events for the installed Flownote app.'
  s.license = { :type => 'MIT' }
  s.author = { 'Flownote' => 'https://github.com/lunce0503/flownote-service' }
  s.homepage = 'https://github.com/lunce0503/flownote-service'
  s.source = { :git => 'https://github.com/lunce0503/flownote-service.git' }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = '**/*.{h,m,mm,swift}'
end
