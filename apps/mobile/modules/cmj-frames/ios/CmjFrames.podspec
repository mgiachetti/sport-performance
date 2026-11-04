Pod::Spec.new do |s|
  s.name           = 'CmjFrames'
  s.version        = '1.0.0'
  s.summary        = 'Exact frames and duration of a CMJ recording (B-604, ADR 0085).'
  s.description    = 'Exact frames and duration of a CMJ recording (B-604, ADR 0085).'
  s.license        = 'UNLICENSED'
  s.author         = 'sport-performance'
  s.homepage       = 'https://github.com/mgiachetti/sport-performance'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
