import type { BackupTargetType } from '@shared/types'
import { t } from '../../lib/i18n'

export interface BackupGuidePart {
  text: string
  href?: string
}

export interface BackupGuideAddress {
  label: string
  url: string
}


export interface BackupPreset {
  id: string
  name: string
  type: BackupTargetType
  quota: string
  tagline: string
  signupUrl: string
  signupLabel?: string
  steps: BackupGuidePart[][]
  addressIntro?: string
  addresses?: BackupGuideAddress[]
  fields: {
    endpoint?: string
    region?: string
    pathStyle?: boolean
    url?: string
  }
}

const textStep = (text: string): BackupGuidePart[] => [{ text }]

const linkStep = (
  prefix: string,
  label: string,
  href: string,
  suffix: string,
): BackupGuidePart[] => [
  { text: prefix },
  { text: ' ' },
  { text: label, href },
  { text: suffix },
]

export function getBackupPresets(): BackupPreset[] {
  return [
    {
      id: 'infinicloud',
      name: 'InfiniCLOUD',
      type: 'webdav',
      quota: t("settings.20_gb_free_25_gb_with_referral_code"),
      tagline: t("settings.only_an_email_address_is_needed_20_gb_free_25_gb_total_with_the_referral"),
      signupUrl: 'https://infini-cloud.net/en/',
      steps: [
        linkStep(
          t("settings.open"),
          'My Page',
          'https://infini-cloud.net/en/modules/mypage/usage/',
          t("settings.and_turn_on_apps_connection"),
        ),
        textStep(t("settings.use_connection_id_as_your_webdav_username_and_apps_password_as_your_webd")),
        textStep(t("settings.enter_referral_code_2hc5e_in_referral_bonus_at_the_bottom_of_my_page_to")),
      ],
      fields: {},
    },
    {
      id: 'koofr',
      name: 'Koofr',
      type: 'webdav',
      quota: t("settings.free_10_gb"),
      tagline: t("settings.only_an_email_address_is_needed_10_gb_free_and_it_can_bridge_google_driv"),
      signupUrl: 'https://app.koofr.net/signup',
      steps: [
        linkStep(
          t("common.open"),
          t("settings.password_settings"),
          'https://app.koofr.net/app/admin/preferences/password',
          t("settings.generate_a_new_app_password_use_your_registration_email_as_the_webdav_us"),
        ),
        textStep(t("settings.koofr_s_own_webdav_address_is_url")),
        textStep(t("settings.koofr_can_also_connect_google_drive_onedrive_and_dropbox_free_users_can")),
        linkStep(
          t("common.open"),
          'Storage',
          'https://app.koofr.net/app/storage/',
          t("settings.click_connect_in_the_left_sidebar_and_choose_the_cloud_storage_you_want"),
        ),
      ],
      addressIntro: t("settings.after_a_storage_account_is_connected_keep_the_same_email_and_app_passwor"),
      addresses: [
        { label: 'Koofr', url: 'https://app.koofr.net/dav/Koofr' },
        { label: 'Google Drive', url: 'https://app.koofr.net/dav/Google Drive' },
        { label: 'OneDrive', url: 'https://app.koofr.net/dav/OneDrive' },
        { label: 'Dropbox', url: 'https://app.koofr.net/dav/Dropbox' },
      ],
      fields: { url: 'https://app.koofr.net/dav/Koofr' },
    },
    {
      id: 'pcloud',
      name: 'pCloud',
      type: 'webdav',
      quota: t("settings.up_to_10_gb"),
      tagline: t("settings.only_an_email_address_is_needed_up_to_10_gb_free_with_standard_webdav_ac"),
      signupUrl: 'https://u.pcloud.com/#/register?invite=GITx7ZvEU1N7',
      signupLabel: t("settings.open_signup_aff"),
      steps: [
        textStep(t("settings.use_url_as_the_webdav_server_url")),
        textStep(t("settings.use_your_registration_email_as_the_webdav_username_and_your_account_pass")),
      ],
      fields: { url: 'https://webdav.pcloud.com/' },
    },
    {
      id: 'backblaze',
      name: 'Backblaze B2',
      type: 's3',
      quota: t("settings.free_10_gb"),
      tagline: t("settings.s3_compatible_object_storage_with_10_gb_free_and_no_credit_card_required"),
      signupUrl: 'https://secure.backblaze.com/user_signin.htm',
      steps: [
        linkStep(
          t("common.open"),
          'Buckets',
          'https://secure.backblaze.com/b2_buckets.htm',
          t("settings.click_create_a_bucket_enter_only_the_bucket_name_leave_the_other_setting"),
        ),
        textStep(t("settings.after_creation_put_the_displayed_endpoint_into_endpoint_use_the_bucket_n")),
        linkStep(
          t("common.open"),
          'Application Keys',
          'https://secure.backblaze.com/app_keys.htm',
          t("settings.click_add_a_new_application_key_enter_any_name_of_key_leave_the_other_se"),
        ),
        textStep(t("settings.use_keyid_as_access_key_id_and_applicationkey_as_secret_access_key")),
      ],
      fields: { region: '', pathStyle: true },
    },
    {
      id: 'r2',
      name: 'Cloudflare R2',
      type: 's3',
      quota: t("settings.free_10_gb"),
      tagline: t("settings.s3_compatible_object_storage_with_10_gb_free_but_it_requires_credit_card"),
      signupUrl: 'https://dash.cloudflare.com/?to=/:account/r2/new',
      signupLabel: t("settings.open_the_r2_console"),
      steps: [
        linkStep(
          t("common.open"),
          t("settings.create_bucket_page"),
          'https://dash.cloudflare.com/?to=/:account/r2/new',
          t("settings.enter_only_the_bucket_name_and_create_it_directly"),
        ),
        linkStep(
          t("common.open"),
          t("settings.api_token_page"),
          'https://dash.cloudflare.com/?to=/:account/r2/api-tokens/create?type=user',
          t("settings.select_object_read_write_for_permissions_and_create_it_directly"),
        ),
        textStep(t("settings.ignore_the_token_value_after_creation_fill_access_key_id_into_access_key")),
        textStep(t("settings.copy_the_address_shown_below_into_endpoint_fill_bucket_exactly_as_shown")),
      ],
      fields: { region: 'auto', pathStyle: true, endpoint: '' },
    },
    {
      id: 'tigris',
      name: 'Tigris',
      type: 's3',
      quota: t("settings.free_5_gb"),
      tagline: t("settings.s3_compatible_object_storage_with_5_gb_free_and_no_credit_card_required"),
      signupUrl: 'https://console.storage.dev/signup',
      steps: [
        linkStep(
          t("common.open"),
          'Create Bucket',
          'https://console.storage.dev/createbucket',
          t("settings.enter_only_the_bucket_name_leave_everything_else_unchanged_and_create_it"),
        ),
        linkStep(
          t("settings.then_open"),
          t("settings.create_access_key_page"),
          'https://console.storage.dev/createaccesskey',
          t("settings.use_any_name_you_like_and_create_it"),
        ),
        textStep(t("settings.ignore_endpoint_url_iam_after_creation_fill_the_other_displayed_values_i")),
        textStep(t("settings.finally_click_manage_key_permissions_and_turn_on_admin_access_otherwise")),
      ],
      fields: { endpoint: 'https://t3.storage.dev', region: 'auto', pathStyle: true },
    },
  ]
}
