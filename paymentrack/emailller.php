<?php
/**
 * Plugin Name: FatbikeKorting Email Customizer
 * Plugin URI: https://fatbikekorting.com
 * Description: Customize WooCommerce order emails with custom branding, including the site logo, email title, and Dutch custom texts.
 * Version: 1.0.0
 * Author: Custom Developer
 * Text Domain: fatbikekorting-email-customizer
 */

// If this file is called directly, abort.
if ( ! defined( 'WPINC' ) ) {
	exit;
}

class FatbikeKorting_Email_Customizer {

	/**
	 * Primary color (from your website)
	 *
	 * @var string
	 */
	private $primary_color = '#ffb800';

	/**
	 * Plugin name for admin
	 *
	 * @var string
	 */
	private $plugin_name = 'FatbikeKorting Email Customizer';

	/**
	 * Options array.
	 *
	 * @var array
	 */
	private $options;

	/**
	 * Constructor.
	 */
	public function __construct() {
		// Check prerequisites and initialize.
		add_action( 'plugins_loaded', array( $this, 'init' ) );

		// Admin menu and settings.
		add_action( 'admin_menu', array( $this, 'add_admin_menu' ) );
		add_action( 'admin_init', array( $this, 'init_settings' ) );

		// Email customization hooks.
		add_filter( 'woocommerce_email_styles', array( $this, 'custom_email_styles' ) );
		add_filter( 'woocommerce_email_footer_text', array( $this, 'custom_email_footer_text' ) );

		// Custom header: we output the site logo and email title.
		add_action( 'woocommerce_email_header', array( $this, 'custom_email_header' ), 10, 2 );
		// Insert custom message before order details.
		add_action( 'woocommerce_email_order_details', array( $this, 'before_order_details' ), 5, 4 );

		// Load options.
		$this->options = get_option( 'fatbikekorting_email_customizer_options', $this->default_options() );
	}

	/**
	 * Plugin initialization.
	 */
	public function init() {
		// Ensure WooCommerce is active.
		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', function() {
				echo '<div class="error"><p>FatbikeKorting Email Customizer vereist dat WooCommerce is geïnstalleerd en geactiveerd.</p></div>';
			} );
			return;
		}
	}

	/**
	 * Default options.
	 *
	 * @return array
	 */
	public function default_options() {
		return array(
			'company_name' => 'FatbikeKorting',
			'footer_text'  => 'Bedankt voor je bestelling bij FatbikeKorting! Bezoek onze <a href="https://fatbikekorting.com">website</a> voor meer informatie.',
			'contact_email'=> 'info@fatbikekorting.com',
			'custom_texts' => array(
				'order_new'         => 'Bedankt voor je bestelling bij FatbikeKorting. We hebben je bestelling ontvangen en zijn bezig met het verwerken ervan.',
				'order_processing'  => 'Je bestelling is in behandeling. We zijn bezig met het voorbereiden van je pakket.',
				'order_completed'   => 'Goed nieuws! Je bestelling is voltooid en is onderweg naar je toe. Bedankt voor je aankoop bij FatbikeKorting.',
				'order_refunded'    => 'Je restitutie is verwerkt. Het bedrag wordt teruggestort op je rekening.',
				'order_cancelled'   => 'Je bestelling is geannuleerd. Als je vragen hebt, neem dan contact met ons op.',
				'order_failed'      => 'Er was een probleem met je bestelling. Neem contact met ons op voor hulp.',
				'order_on_hold'     => 'Je bestelling is momenteel in de wacht. We wachten op bevestiging van betaling.',
			),
		);
	}

	/**
	 * Add the admin menu under WooCommerce.
	 */
	public function add_admin_menu() {
		add_submenu_page(
			'woocommerce',
			'FatbikeKorting Email Customizer',
			'Email Customizer',
			'manage_options',
			'fatbikekorting-email-customizer',
			array( $this, 'admin_page' )
		);
	}

	/**
	 * Initialize plugin settings.
	 */
	public function init_settings() {
		register_setting(
			'fatbikekorting_email_customizer_settings',
			'fatbikekorting_email_customizer_options',
			array( $this, 'validate_options' )
		);
	}

	/**
	 * Validate and sanitize options.
	 *
	 * @param array $input
	 * @return array
	 */
	public function validate_options( $input ) {
		$default_options = $this->default_options();
		$validated       = array();

		$validated['company_name'] = sanitize_text_field( $input['company_name'] );
		$validated['footer_text']  = wp_kses_post( $input['footer_text'] );
		$validated['contact_email']= sanitize_email( $input['contact_email'] );

		// Validate custom texts.
		foreach ( $default_options['custom_texts'] as $key => $default_text ) {
			$validated['custom_texts'][ $key ] = isset( $input['custom_texts'][ $key ] ) ? wp_kses_post( $input['custom_texts'][ $key ] ) : $default_text;
		}

		return $validated;
	}

	/**
	 * Render the admin page.
	 */
	public function admin_page() {
		?>
		<div class="wrap">
			<h1><?php echo esc_html( $this->plugin_name ); ?></h1>
			<form method="post" action="options.php">
				<?php settings_fields( 'fatbikekorting_email_customizer_settings' ); ?>
				<table class="form-table">
					<tr>
						<th scope="row">
							<label for="fatbikekorting_email_customizer_options[company_name]">Company Name</label>
						</th>
						<td>
							<input type="text" id="fatbikekorting_email_customizer_options[company_name]" name="fatbikekorting_email_customizer_options[company_name]" value="<?php echo esc_attr( $this->options['company_name'] ); ?>" class="regular-text" />
						</td>
					</tr>
					<tr>
						<th scope="row">
							<label for="fatbikekorting_email_customizer_options[footer_text]">Footer Text</label>
						</th>
						<td>
							<textarea id="fatbikekorting_email_customizer_options[footer_text]" name="fatbikekorting_email_customizer_options[footer_text]" rows="3" class="large-text"><?php echo esc_textarea( $this->options['footer_text'] ); ?></textarea>
							<p class="description">Custom footer text (HTML allowed)</p>
						</td>
					</tr>
					<tr>
						<th scope="row">
							<label for="fatbikekorting_email_customizer_options[contact_email]">Contact Email</label>
						</th>
						<td>
							<input type="email" id="fatbikekorting_email_customizer_options[contact_email]" name="fatbikekorting_email_customizer_options[contact_email]" value="<?php echo esc_attr( $this->options['contact_email'] ); ?>" class="regular-text" />
						</td>
					</tr>
				</table>
				
				<h2>Email Custom Messages</h2>
				<p>Customize the messages displayed in different email notifications (Dutch text)</p>
				
				<table class="form-table">
					<?php foreach ( $this->options['custom_texts'] as $key => $text ) : ?>
					<tr>
						<th scope="row">
							<label for="fatbikekorting_email_customizer_options[custom_texts][<?php echo $key; ?>]"><?php echo ucwords( str_replace( '_', ' ', $key ) ); ?></label>
						</th>
						<td>
							<textarea id="fatbikekorting_email_customizer_options[custom_texts][<?php echo $key; ?>]" name="fatbikekorting_email_customizer_options[custom_texts][<?php echo $key; ?>]" rows="3" class="large-text"><?php echo esc_textarea( $text ); ?></textarea>
						</td>
					</tr>
					<?php endforeach; ?>
				</table>
				
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}

	/**
	 * Add custom CSS to WooCommerce email styles.
	 *
	 * @param string $css
	 * @return string
	 */
	public function custom_email_styles( $css ) {
		$custom_css = "
			#custom_email_header {
				background-color: {$this->primary_color};
				padding: 24px 48px;
				text-align: center;
			}
			#custom_email_header h1 {
				color: #ffffff;
				font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
				margin: 0;
				padding-top: 10px;
			}
			.order-details-wrapper {
				padding: 20px;
				border: 1px solid #e5e5e5;
				border-radius: 5px;
				margin-top: 20px;
				margin-bottom: 20px;
			}
			.fatbikekorting-message {
				padding: 15px;
				font-size: 16px;
				line-height: 24px;
				margin-bottom: 20px;
			}
			#template_footer {
				background-color: #f7f7f7;
				padding: 20px 48px;
				text-align: center;
			}
		";
		return $css . $custom_css;
	}

	/**
	 * Output custom email header with the site logo and email title.
	 *
	 * @param string $email_heading
	 * @param object $email
	 */
	public function custom_email_header( $email_heading, $email ) {
		echo '<div id="custom_email_header">';

		// Use the site logo from the theme (if set) or fallback to the site name.
		if ( function_exists( 'has_custom_logo' ) && has_custom_logo() ) {
			echo get_custom_logo();
		} else {
			echo '<h2>' . esc_html( get_bloginfo( 'name' ) ) . '</h2>';
		}

		// Display the email title (heading) in Dutch.
		echo '<h1>' . esc_html( $email_heading ) . '</h1>';
		echo '</div>';
	}

	/**
	 * Customize the email footer text.
	 *
	 * @return string
	 */
	public function custom_email_footer_text() {
		return wp_kses_post( $this->options['footer_text'] );
	}

	/**
	 * Display a custom message above the order details.
	 *
	 * @param WC_Order $order
	 * @param bool     $sent_to_admin
	 * @param bool     $plain_text
	 * @param object   $email
	 */
	public function before_order_details( $order, $sent_to_admin, $plain_text, $email ) {
		if ( ! is_a( $order, 'WC_Order' ) || $plain_text ) {
			return;
		}

		$template_type = isset( $email->id ) ? $email->id : '';
		$message       = $this->get_custom_message_by_email_type( $template_type );

		if ( ! empty( $message ) ) {
			echo '<div class="fatbikekorting-message">' . wp_kses_post( $message ) . '</div>';
		}
	}

	/**
	 * Get the custom message based on the email type.
	 *
	 * @param string $email_type
	 * @return string
	 */
	public function get_custom_message_by_email_type( $email_type ) {
		$message_key = 'order_new'; // Default.

		switch ( $email_type ) {
			case 'customer_completed_order':
				$message_key = 'order_completed';
				break;
			case 'customer_processing_order':
				$message_key = 'order_processing';
				break;
			case 'customer_refunded_order':
				$message_key = 'order_refunded';
				break;
			case 'customer_on_hold_order':
				$message_key = 'order_on_hold';
				break;
			case 'customer_cancelled_order':
				$message_key = 'order_cancelled';
				break;
			case 'failed_order':
				$message_key = 'order_failed';
				break;
			case 'customer_new_order':
				$message_key = 'order_new';
				break;
		}

		return isset( $this->options['custom_texts'][ $message_key ] ) ? $this->options['custom_texts'][ $message_key ] : '';
	}
}

// Initialize the plugin.
new FatbikeKorting_Email_Customizer();
